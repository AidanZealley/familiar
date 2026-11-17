import { queryOptions } from '@tanstack/react-query'

/** A model provider that takes an API key, and whether it has a credential. */
export type ProviderKey = { id: string; name: string; set: boolean }

/**
 * Model providers' API keys, which the daemon saves in its encrypted
 * credential store. Null where nothing serves them: the host manages its
 * models' credentials itself.
 */
export const providerKeysQuery = queryOptions({
  queryKey: ['provider-keys'],
  queryFn: async (): Promise<ProviderKey[] | null> => {
    const response = await fetch('/api/providers')
    if (response.status === 404) {
      return null
    }
    await check(response)
    return (await response.json()) as ProviderKey[]
  },
})

/** Saves `id`'s key, or removes it with null. Write-only: no key comes back. */
export async function setProviderKey(id: string, key: string | null) {
  await check(
    await fetch(`/api/providers/${encodeURIComponent(id)}/key`, {
      method: key === null ? 'DELETE' : 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: key === null ? undefined : JSON.stringify({ key }),
    }),
  )
}

async function check(response: Response) {
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string
    }
    throw new Error(body.error ?? response.statusText)
  }
}
