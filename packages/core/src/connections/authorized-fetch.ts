import type { PluginFetch, PluginSecret } from './types.ts'

/** Why a declaration can't be used; thrown when Familiar opens. */
export function checkDeclaration(plugin: string, secret: PluginSecret) {
  const { origin, requests } = secret.sendAs
  if (!URL.canParse(origin) || new URL(origin).origin !== origin) {
    throw new Error(
      `${plugin}'s secret ${secret.name} must be sent to an exact origin, like https://api.example.com, not ${origin}.`,
    )
  }
  if (!origin.startsWith('https:')) {
    throw new Error(
      `${plugin}'s secret ${secret.name} must be sent over https.`,
    )
  }
  if (requests.length === 0) {
    throw new Error(
      `${plugin}'s secret ${secret.name} must declare the requests it's sent with.`,
    )
  }
}

/**
 * A request that carries a secret, made only if it goes exactly where the
 * secret declares. The caller never sees the value: it's added here, after
 * the checks, and redirects come back as responses rather than being
 * followed, so the value is never sent anywhere else.
 */
export async function authorizedFetch(
  fetch: PluginFetch,
  secret: PluginSecret,
  value: () => Promise<string>,
  input: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  const { header, prefix = '', origin, requests } = secret.sendAs
  const url = new URL(input)
  const method = (init.method ?? 'GET').toUpperCase()
  const refuse = (reason: string) => {
    throw new Error(`${secret.label} isn't sent ${reason}.`)
  }

  if (url.origin !== origin) {
    refuse(`to ${url.origin}, only to ${origin}`)
  }
  if (url.username || url.password) {
    refuse('with a username or password in the URL')
  }
  if (
    !requests.some(
      (request) =>
        request.method.toUpperCase() === method &&
        request.path === url.pathname,
    )
  ) {
    refuse(`with ${method} ${url.pathname}`)
  }
  const headers = new Headers(init.headers)
  if (headers.has(header) || headers.has('host')) {
    refuse(`with a ${header} or Host header set by the caller`)
  }

  headers.set(header, prefix + (await value()))
  return fetch(url, { ...init, method, headers, redirect: 'manual' })
}
