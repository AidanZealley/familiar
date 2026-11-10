import type { EntryId } from '@earendil-works/pi-durable'
import { Hono, type Context, type TypedResponse } from 'hono'
import { validator } from 'hono/validator'
import { can, type AccessEnv } from '../access.ts'
import type { HistoryPage } from '../conversation/index.ts'
import { MessageError } from '../conversation/message.ts'
import { streamEvents } from '../http/events.ts'
import { found } from '../http/found.ts'
import type { Mention } from './log.ts'
import { RoomError, type RoomId, type RoomSetup } from './rooms.ts'
import type { RoomApi, RoomsApi } from './index.ts'

/** Answers `run`'s response, or 400 when the rooms' or messages' rules refuse it. */
async function refusable(c: Context, run: () => Promise<Response>) {
  try {
    return await run()
  } catch (error) {
    if (error instanceof RoomError || error instanceof MessageError) {
      return c.json({ error: error.message }, 400)
    }
    throw error
  }
}

/** A named room's setup, as far as the body gives it; `RoomsApi` checks the rest. */
const setup = validator('json', (body, c) => {
  const { name, familiars, lead } = (body ?? {}) as Record<string, unknown>
  if (
    (name !== undefined && typeof name !== 'string') ||
    (familiars !== undefined &&
      !(Array.isArray(familiars) && familiars.every(Number.isSafeInteger))) ||
    (lead !== undefined && !Number.isSafeInteger(lead))
  ) {
    return c.json(
      { error: 'name must be text, familiars and lead Familiar IDs' },
      400,
    )
  }
  // IDs on the wire are plain numbers; `RoomsApi` checks they're Familiars.
  return body as { name?: string; familiars?: number[]; lead?: number }
})

/**
 * Rooms, mounted at `/rooms`: the ones the person asking sees, setting them
 * up, and each room's messages, history, Stop and `/events`. Message
 * attribution comes only from the host, never the body.
 */
export function roomRoutes(rooms: RoomsApi) {
  const idOf = (c: Context) => Number(c.req.param('room')) as RoomId
  // Someone else's DM is no such room, so nobody learns it exists.
  const roomOf = async (c: Context<AccessEnv>) =>
    found(await rooms.get(idOf(c), c.get('author').id), 'room')

  return (
    new Hono<AccessEnv>()
      // Every named room and the person's own DMs.
      .get('/', can('rooms.list'), async (c) =>
        c.json(await rooms.list(c.get('author').id), 200),
      )
      .post('/', can('rooms.create'), setup, (c) =>
        refusable(c, async () =>
          c.json(
            { id: await rooms.create(c.req.valid('json') as RoomSetup) },
            201,
          ),
        ),
      )
      .patch('/:room', can('rooms.update'), setup, (c) =>
        refusable(c, async () => {
          await roomOf(c)
          await rooms.update(idOf(c), c.req.valid('json') as Partial<RoomSetup>)
          return c.body(null, 204)
        }),
      )
      // Hides a named room and closes it, keeping its history.
      .delete('/:room', can('rooms.archive'), (c) =>
        refusable(c, async () => {
          await roomOf(c)
          await rooms.archive(idOf(c))
          return c.body(null, 204)
        }),
      )
      .post(
        '/:room/messages',
        can('rooms.post'),
        // Only the shape here: `post` owns the bounds, for every caller.
        validator('json', (body, c) => {
          if (typeof body?.text !== 'string') {
            return c.json({ error: 'text is required' }, 400)
          }
          if (typeof body.requestId !== 'string') {
            return c.json({ error: 'requestId is required' }, 400)
          }
          if (body.mentions !== undefined && !Array.isArray(body.mentions)) {
            return c.json({ error: 'mentions must be a list' }, 400)
          }
          return {
            text: body.text as string,
            requestId: body.requestId as string,
            ...(body.mentions !== undefined && {
              mentions: body.mentions as Mention[],
            }),
          }
        }),
        (c) =>
          refusable(c, async () => {
            const room = await roomOf(c)
            await room.post({ author: c.get('author'), ...c.req.valid('json') })
            return c.body(null, 202)
          }),
      )
      // A page of entries older than `before`, newest first.
      .get(
        '/:room/history',
        can('rooms.history'),
        validator('query', (query, c) => {
          const before = Number(query.before)
          if (!Number.isSafeInteger(before)) {
            return c.json({ error: 'before must be an entry ID' }, 400)
          }
          return { before: before as EntryId }
        }),
        async (c) => {
          const room = await roomOf(c)
          const page = await room.history(c.req.valid('query').before, 50)
          // Pi's entries are already JSON, but their recursive types are too
          // deep for Hono to convert, so the client gets the page's own type.
          return c.json(page) as unknown as TypedResponse<
            HistoryPage,
            200,
            'json'
          >
        },
      )
      // Stops every turn in the room, and nothing elsewhere.
      .post('/:room/stop', can('rooms.stop'), async (c) => {
        await (await roomOf(c)).stop()
        return c.body(null, 202)
      })
      // The room's log, then its turns in progress, live.
      .get('/:room/events', (c) => {
        // Found only once the stream is allowed.
        let room: RoomApi
        return streamEvents(
          c,
          [
            {
              operation: 'events.room',
              open: async (stream) => {
                await stream.view(() => room.watch())
                await stream.document('turns', () => room.watchTurns())
              },
            },
          ],
          { room: idOf(c) },
          async () => {
            room = await roomOf(c)
          },
        )
      })
  )
}
