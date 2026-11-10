import {
  openWorkspace,
  type Author,
  type RoomId,
  type Workspace,
  type WorkspaceOptions,
} from '@familiar-ai/core'
import { createHttpApi, type Operation } from '@familiar-ai/core/http'

/** Who a request is from, and the tenant their session is in. */
export type Member = { author: Author; tenant: string }

// Members may find their tenant's room, talk in it and watch it.
const CHAT = new Set<Operation>([
  'rooms.list',
  'rooms.post',
  'rooms.history',
  'rooms.stop',
  'events.room',
])

/** A tenant's workspace, with its one Familiar and the room members share. */
type Tenant = { workspace: Workspace; room: RoomId }

/** Opens a tenant's workspace, making its Familiar and room on the first open. */
async function openTenant(options: WorkspaceOptions): Promise<Tenant> {
  const workspace = await openWorkspace(options)
  const [shared] = await workspace.rooms.list()
  if (shared) {
    return { workspace, room: shared.id }
  }
  const familiar = await workspace.familiars.create({ name: 'Familiar' })
  const room = await workspace.rooms.create({
    name: 'Team',
    familiars: [familiar.id],
    lead: familiar.id,
  })
  return { workspace, room }
}

const tenantApi = ({ workspace, room }: Tenant, author: Author) =>
  createHttpApi(workspace, {
    authenticate: () => author,
    // Only the tenant's shared room, never a DM.
    allow: (_, operation, resource) =>
      CHAT.has(operation) &&
      (resource === undefined ||
        ('room' in resource && resource.room === room)),
  })

/**
 * One workspace per tenant, each over that tenant's own storage. The session
 * chooses the tenant, never the request, so members reach only their own
 * tenant's room, memory, tools and schedules.
 */
export function createTenantsHost(options: {
  /** Your session check: the member, or undefined to refuse. */
  member: (request: Request) => Promise<Member | undefined>
  /** The tenant's workspace: its own storage, tools and `notify`. */
  workspace: (tenant: string) => WorkspaceOptions
}) {
  // One live workspace per storage, opened on the tenant's first request.
  // Failed openings stay cached until this host is restarted.
  const tenants = new Map<string, Promise<Tenant>>()
  const tenantOf = (tenant: string) => {
    let opened = tenants.get(tenant)
    if (!opened) {
      opened = openTenant(options.workspace(tenant))
      tenants.set(tenant, opened)
    }
    return opened
  }

  return {
    async fetch(request: Request) {
      const member = await options.member(request)
      if (!member) {
        return Response.json({ error: 'unauthorized' }, { status: 401 })
      }
      const tenant = await tenantOf(member.tenant)
      return tenantApi(tenant, member.author).fetch(request)
    },
    async dismiss() {
      const results = await Promise.allSettled(
        [...tenants.values()].map(async (tenant) =>
          (await tenant).workspace.dismiss(),
        ),
      )
      const failures = results
        .filter((result) => result.status === 'rejected')
        .map((result) => result.reason)
      if (failures.length) {
        throw new AggregateError(
          failures,
          'Some tenant instances failed to close.',
        )
      }
    },
  }
}
