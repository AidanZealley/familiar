import {
  summonFamiliar,
  type Author,
  type Familiar,
  type FamiliarOptions,
} from '@familiar-ai/core'
import { createHttpApi } from '@familiar-ai/core/http'

/** Who a request is from, and the tenant their session is in. */
export type Member = { author: Author; tenant: string }

const tenantApi = (familiar: Familiar, author: Author) =>
  createHttpApi(familiar, {
    authenticate: () => author,
    routes: {
      conversation: { send: true, history: true, abort: true },
      events: { conversation: true },
    },
  })

export type TenantApi = ReturnType<typeof tenantApi>

/**
 * One Familiar per tenant, each over that tenant's own storage. The session
 * chooses the tenant, never the request, so members reach only their own
 * tenant's conversation, memory, tools and schedules.
 */
export function createTenantsHost(options: {
  /** Your session check: the member, or undefined to refuse. */
  member: (request: Request) => Promise<Member | undefined>
  /** The tenant's Familiar: its own storage, tools and `notify`. */
  familiar: (tenant: string) => FamiliarOptions
}) {
  // One live Familiar per storage, opened on the tenant's first request.
  // Failed openings stay cached until this host is restarted.
  const familiars = new Map<string, Promise<Familiar>>()
  const familiarOf = (tenant: string) => {
    let familiar = familiars.get(tenant)
    if (!familiar) {
      familiar = summonFamiliar(options.familiar(tenant))
      familiars.set(tenant, familiar)
    }
    return familiar
  }

  return {
    async fetch(request: Request) {
      const member = await options.member(request)
      if (!member) {
        return Response.json({ error: 'unauthorized' }, { status: 401 })
      }
      const familiar = await familiarOf(member.tenant)
      return tenantApi(familiar, member.author).fetch(request)
    },
    async dismiss() {
      const results = await Promise.allSettled(
        [...familiars.values()].map(async (familiar) =>
          (await familiar).dismiss(),
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
