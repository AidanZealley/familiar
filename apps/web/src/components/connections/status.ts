import type { ConnectionInfo } from '@familiar-ai/client'

export type Tone = 'ok' | 'busy' | 'warn' | 'bad' | 'off'

/**
 * How a connection reads to the owner, and what they can do about it, if
 * anything. Lower ranks need them sooner.
 */
export function statusOf(connection: ConnectionInfo): {
  label: string
  tone: Tone
  rank: number
  advice?: string
} {
  if (connection.kind === 'plugin') {
    return connection.secrets.some((secret) => !secret.set)
      ? {
          label: 'Key not set',
          tone: 'warn',
          rank: 3,
          advice: 'Set its key so Familiar can use it.',
        }
      : {
          label: 'Ready',
          tone: 'ok',
          rank: 5,
          advice: "Installed with Familiar, so it can't be removed here.",
        }
  }
  switch (connection.status.type) {
    case 'failed':
      return {
        label: 'Failed',
        tone: 'bad',
        rank: 0,
        advice: 'Reconnect to try again.',
      }
    case 'needs-auth':
      // The server only asks again for a token it was given if it refused it.
      return connection.secrets.some((secret) => secret.set)
        ? {
            label: 'Token refused',
            tone: 'warn',
            rank: 1,
            advice:
              'The server refused the saved token. Replace it to try again.',
          }
        : {
            label: 'Needs a token',
            tone: 'warn',
            rank: 1,
            advice: 'Add its bearer token to connect.',
          }
    case 'disconnected':
      return {
        label: 'Disconnected',
        tone: 'off',
        rank: 2,
        advice:
          connection.transport.type === 'stdio'
            ? 'The process exited. Reconnect starts it again.'
            : 'The connection closed. Reconnect to try again.',
      }
    case 'connecting':
      return { label: 'Connecting', tone: 'busy', rank: 4 }
    case 'connected':
      return { label: 'Connected', tone: 'ok', rank: 5 }
  }
}

export const needsAttention = (connection: ConnectionInfo) =>
  statusOf(connection).rank <= 3

export const idOf = (connection: ConnectionInfo) =>
  `${connection.kind}:${connection.name}`

/** Where an MCP server lives: its URL, or the command it runs. */
export const whereOf = (connection: ConnectionInfo) => {
  if (connection.kind === 'plugin') {
    return 'Plugin'
  }
  const { transport } = connection
  return transport.type === 'http'
    ? transport.url
    : [transport.command, ...transport.args].join(' ')
}
