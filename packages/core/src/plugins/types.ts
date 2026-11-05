import type { Extension } from '@earendil-works/pi-durable'
import type { Notification } from '../notify.ts'
import type { PluginFetch, PluginSecret } from '../connections/index.ts'

/**
 * What Familiar gives a plugin's extension. Credentials are attached by
 * authorizedFetch, rather than passed to plugin code.
 */
export type PluginContext = {
  now(): number
  /** The owner's IANA time zone. Write times with `localMinute`, as Familiar does. */
  timeZone: string
  notify(notification: Notification): Promise<void>
  /** The host's fetch, which keeps plugins off its private networks. */
  fetch: PluginFetch
  /**
   * A request carrying the named secret, made through `fetch` only if it
   * matches what the secret declares; otherwise throws without sending.
   * Throws a message the model reads as "not connected" when it isn't set.
   * Redirects come back as responses, unfollowed.
   */
  authorizedFetch(
    secret: string,
    input: string | URL,
    init?: RequestInit,
  ): Promise<Response>
}

/** Familiar supplies the installed name; every Pi extension capability is retained. */
export type PluginExtension = Omit<Extension, 'name'>

/**
 * Everything that isn't core arrives as a plugin: an extension, built with
 * what Familiar provides around it. Core names the extension
 * `familiar.plugin.<name>`.
 */
export type FamiliarPlugin = {
  /** Keys its secrets, so keep it stable. */
  name: string
  /** For the owner, on the Connections page. */
  title: string
  secrets?: PluginSecret[]
  extension: (context: PluginContext) => PluginExtension
}
