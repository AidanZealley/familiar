import type { ConnectionInfo } from '@familiar/client'

export type Tone = 'ok' | 'busy' | 'warn' | 'bad' | 'off'

/** How a connection reads to the owner. Lower ranks need them sooner. */
export function statusOf(connection: ConnectionInfo): {
  label: string
  tone: Tone
  rank: number
} {
  if (connection.kind === 'plugin') {
    return connection.secrets.some((secret) => !secret.set)
      ? { label: 'Key not set', tone: 'warn', rank: 3 }
      : { label: 'Ready', tone: 'ok', rank: 5 }
  }
  switch (connection.status.type) {
    case 'failed':
      return { label: 'Failed', tone: 'bad', rank: 0 }
    case 'needs-auth':
      // The server only asks again for a token it was given if it refused it.
      return connection.secrets.some((secret) => secret.set)
        ? { label: 'Token refused', tone: 'warn', rank: 1 }
        : { label: 'Needs a token', tone: 'warn', rank: 1 }
    case 'disconnected':
      return { label: 'Disconnected', tone: 'off', rank: 2 }
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
