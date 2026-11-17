import { queryOptions } from '@tanstack/react-query'

export type ComputerStatus = 'none' | 'asleep' | 'offline' | 'online'

/** A Familiar's computer, as its host reports it. */
export type Computer = {
  status: ComputerStatus
  /** Whether the host's provider runs it, not a machine paired by hand. */
  provided: boolean
  /** Whether the host has a provider that can give Familiars computers. */
  provider: boolean
}

/**
 * A Familiar's computer. Null where nothing serves computers: the host
 * doesn't offer them. Refreshed often, since a computer sleeps and wakes by
 * itself, and a paired machine connects when its owner runs the agent.
 */
export const computerQuery = (familiar: number) =>
  queryOptions({
    queryKey: ['computer', familiar],
    queryFn: async (): Promise<Computer | null> => {
      const response = await fetch(`/api/computers/${familiar}`)
      if (response.status === 404) {
        return null
      }
      await check(response)
      return (await response.json()) as Computer
    },
    refetchInterval: 5_000,
  })

/** A login on a Familiar's computer: never its password. */
export type ComputerLogin = { site: string; username: string }

/** The logins on the Familiar's computer. */
export const loginsQuery = (familiar: number) =>
  queryOptions({
    queryKey: ['computer', familiar, 'logins'],
    queryFn: async () => {
      const response = await fetch(`/api/computers/${familiar}/logins`)
      await check(response)
      return (await response.json()) as ComputerLogin[]
    },
  })

/**
 * Saves a login on the Familiar's computer in place of any for its site,
 * straight to the host, never through chat.
 */
export async function saveLogin(
  familiar: number,
  login: ComputerLogin & { password: string },
) {
  await check(
    await fetch(`/api/computers/${familiar}/logins`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(login),
    }),
  )
}

/** Deletes the login for `site` from the Familiar's computer. */
export async function deleteLogin(familiar: number, site: string) {
  await check(
    await fetch(
      `/api/computers/${familiar}/logins?${new URLSearchParams({ site })}`,
      { method: 'DELETE' },
    ),
  )
}

/** Gives the Familiar a computer the host's provider runs. */
export async function provideComputer(familiar: number) {
  await post(familiar, { provider: true })
}

/** Gives the Familiar a machine to pair: the link to run the agent with. */
export async function pairComputer(familiar: number) {
  return ((await post(familiar, {})) as { link: string }).link
}

/** Removes the Familiar's computer, with its disk if the provider ran it. */
export async function removeComputer(familiar: number) {
  await check(
    await fetch(`/api/computers/${familiar}`, {
      method: 'DELETE',
    }),
  )
}

async function post(familiar: number, body: object) {
  const response = await fetch(`/api/computers/${familiar}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  await check(response)
  return response.json()
}

async function check(response: Response) {
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string
    }
    throw new Error(body.error ?? response.statusText)
  }
}
