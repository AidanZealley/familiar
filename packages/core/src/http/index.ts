import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { accountRoutes } from '../account/http.ts'
import type { Author } from '../conversation/message.ts'
import { mcpRoutes } from '../mcp/http.ts'
import { connectionRoutes } from '../connections/http.ts'
import { roomRoutes } from '../rooms/http.ts'
import { defaultRoutes, familiarRoutes, meRoutes } from '../workspace/http.ts'
import type { Workspace } from '../workspace/index.ts'
import type { AccessEnv, Allow } from '../access.ts'
import { streamEvents } from './events.ts'
import { pushRoutes, type PushHost } from './push.ts'

// The wire contract every client speaks, and the names `allow` is asked about.
export type * from './contract.ts'
export type {
  Allow,
  FamiliarOperation,
  Operation,
  Resource,
  RoomOperation,
  WorkspaceOperation,
} from '../access.ts'

export type HttpOptions = {
  /**
   * Who is making this request, or undefined to refuse it with 401. Hosts
   * own auth: the daemon trusts its network, an app checks its own session.
   * The answer is the author of any message the request sends, which the
   * model sees.
   */
  authenticate: (
    request: Request,
  ) => Author | undefined | Promise<Author | undefined>
  /**
   * Whether an author may perform an operation, asked before the route reads
   * anything or changes anything; anything but `true` answers 403. A
   * Familiar's or room's operation comes with its ID, so a host can refuse
   * per Familiar or room, such as someone else's DM. Each `/events` asks
   * once per source as a stream connects. Check against a list of the
   * operations you allow, so any Familiar adds later is refused until you
   * add it; `() => true` only when everyone `authenticate` accepts is the
   * workspace's owner.
   */
  allow: Allow
  /** Web Push, if the host offers it; the push routes answer 404 without it. */
  push?: PushHost
  /**
   * The most bytes a request body may have; larger ones get 413 before any
   * route reads them. Default `DEFAULT_MAX_BODY_SIZE`. Field bounds, such
   * as `MESSAGE_LIMITS`, are enforced by Familiar itself for every caller.
   */
  maxBodySize?: number
}

/**
 * Room for the largest message Familiar admits, `MESSAGE_LIMITS.text`, even
 * if JSON escapes every character, with every other request far under it.
 */
export const DEFAULT_MAX_BODY_SIZE = 1024 * 1024

const routes = (workspace: Workspace, push: PushHost | undefined) =>
  new Hono<AccessEnv>()
    .route('/account', accountRoutes(workspace.account))
    .route('/push', pushRoutes(push))
    .route('/connections', connectionRoutes(workspace.connections))
    .route('/mcp', mcpRoutes(workspace.mcp))
    .route('/familiars', familiarRoutes(workspace))
    .route('/defaults', defaultRoutes(workspace))
    .route('/rooms', roomRoutes(workspace.rooms))
    .route('/me', meRoutes(workspace))
    // Who the Familiars are, the rooms the person sees, who they are, and
    // the login.
    .get('/events', (c) =>
      streamEvents(c, [
        {
          operation: 'events.familiars',
          open: (stream) =>
            stream.document('familiars', workspace.familiars.watch),
        },
        {
          operation: 'events.rooms',
          open: (stream) =>
            stream.document('rooms', () =>
              workspace.rooms.watch(c.get('author').id),
            ),
        },
        {
          operation: 'events.me',
          open: (stream) =>
            stream.document('me', () =>
              workspace.people.watch(c.get('author')),
            ),
        },
        {
          operation: 'events.account',
          open: async (stream) => {
            // Null once when the host manages credentials itself.
            const { account } = workspace
            await stream.send({
              event: 'account',
              data: account?.state() ?? null,
            })
            if (account) {
              stream.onEnd(
                account.onChange(
                  (state) =>
                    void stream.send({ event: 'account', data: state }),
                ),
              )
            }
          },
        },
      ]),
    )

/** Familiar's HTTP API, for Hono's typed client: `hc<HttpApi>(baseUrl)`. */
export type HttpApi = ReturnType<typeof routes>

/**
 * A workspace's HTTP API as a fetch handler: the workspace, its Familiars
 * and its rooms. Every request is authenticated first (401), then its body
 * is bounded (413), then `allow` is asked (403), all before the route reads
 * the body or changes anything; a missing Familiar or room is 404 after.
 * Mount it under any path.
 *
 * People talk to Familiars only in rooms. Everyone who can read a room reads
 * whatever its Familiars say there, which can include anything they
 * remember: refusing `events.memory` doesn't make memory private. A Familiar
 * also carries what it learns in one room into the others. Everyone shares
 * every tool installed on the workspace; a tool or the app API behind it
 * narrows what each may do, using `familiar(context).author()`.
 */
export function createHttpApi(
  workspace: Workspace,
  options: HttpOptions,
): HttpApi {
  if (typeof options.allow !== 'function') {
    throw new TypeError('allow must be a function.')
  }
  return new Hono<AccessEnv>()
    .use(async (c, next) => {
      const author = await options.authenticate(c.req.raw)

      if (author === undefined) {
        return c.json({ error: 'unauthorized' }, 401)
      }

      c.set('author', author)
      c.set('allow', options.allow)
      await next()
    })
    .use(bodyLimit({ maxSize: options.maxBodySize ?? DEFAULT_MAX_BODY_SIZE }))
    .route('/', routes(workspace, options.push))
}
