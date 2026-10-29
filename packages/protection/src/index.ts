import type { PluginProtection } from '@familiar/core'
import { createRedactor } from './redactor.ts'
import { maskResponse } from './response.ts'
import { maskTool } from './tool.ts'

/**
 * Best-effort masking of known keys in network responses and plugin output.
 * This is not a sandbox: plugins still run as trusted code in the host process.
 */
export const maskSecrets: PluginProtection = ({
  fetch,
  secrets,
  credentials,
}) => {
  const redactor = createRedactor()
  let loaded: Promise<unknown> | undefined
  const ready = () =>
    (loaded ??= Promise.all(
      credentials.map(async ({ connection, secret }) => {
        redactor.remember(await secrets?.get(connection, secret))
      }),
    ))

  return {
    // Observe the store, retaining old values for calls already in flight.
    secrets: secrets
      ? {
          get: async (connection, secret) =>
            redactor.remember(await secrets.get(connection, secret)),
          set: async (connection, secret, value) => {
            await secrets.set(connection, secret, value)
            redactor.remember(value)
          },
          delete: (connection, secret) => secrets.delete(connection, secret),
        }
      : undefined,
    fetch: async (input, init) => {
      await ready()
      try {
        return await maskResponse(await fetch(input, init), redactor)
      } catch (error) {
        // A host's fetch error can include request headers containing a key.
        // eslint-disable-next-line preserve-caught-error
        throw new Error(
          redactor.text(error instanceof Error ? error.message : String(error)),
        )
      }
    },
    wrapTool: (tool) => maskTool(tool, redactor, ready),
  }
}
