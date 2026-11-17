import { lookup } from 'node:dns'
import { createServer, request, type IncomingMessage } from 'node:http'
import { BlockList, connect, isIP, Socket, type LookupFunction } from 'node:net'
import type { Duplex } from 'node:stream'

/** Where the host's computers connect, the one path the forward passes. */
export const CONNECT_PATH = '/api/computers/connect'
/** The proxy's ports: HTTP(S) to the internet, and the forward to the host. */
export const PROXY_PORT = 3128
export const FORWARD_PORT = 3129

/**
 * Addresses that aren't the public internet: this machine, private and
 * shared networks (Tailscale's among them), link-local, and the rest IANA
 * reserves. An IPv6 address wrapping an IPv4 one is checked as that one.
 */
const notPublic = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 3],
] as const) {
  notPublic.addSubnet(network, prefix, 'ipv4')
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  notPublic.addSubnet(network, prefix, 'ipv6')
}

export function isPublic(address: string) {
  const v4 = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1]
  if (v4) {
    return !notPublic.check(v4, 'ipv4')
  }
  const family = isIP(address)
  return (
    family !== 0 && !notPublic.check(address, family === 4 ? 'ipv4' : 'ipv6')
  )
}

const notPublicError = (host: string) =>
  Object.assign(new Error(`${host} isn't on the public internet.`), {
    code: 'ENOTPUBLIC',
  })

/**
 * Resolves a name as `connect` does, refusing one that leads anywhere but
 * the public internet. The connection then uses the address checked, so a
 * name can't resolve differently between the check and the connection.
 */
const publicLookup: LookupFunction = (hostname, options, done) =>
  lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) {
      return done(error, '')
    }
    if (
      !addresses.length ||
      !addresses.every(({ address }) => isPublic(address))
    ) {
      return done(notPublicError(hostname), '')
    }
    if (options.all) {
      return (done as (error: null, all: typeof addresses) => void)(
        null,
        addresses,
      )
    }
    done(null, addresses[0]!.address, addresses[0]!.family)
  })

/** A connection to `host:port` on the public internet only. */
function connectPublic(host: string, port: number) {
  const name = host.replace(/^\[|\]$/g, '')
  // `connect` looks up names only, so an address is checked here.
  if (isIP(name) && !isPublic(name)) {
    const socket = new Socket()
    process.nextTick(() => socket.destroy(notPublicError(host)))
    return socket
  }
  return connect({ host: name, port, lookup: publicLookup })
}

const refuse = (socket: Duplex, status: string) =>
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`)

/** Joins two connections, closing each when the other fails. */
function join(from: Duplex, to: Socket) {
  from.on('error', () => to.destroy())
  to.on('error', () => from.destroy())
  from.pipe(to).pipe(from)
}

export type ProxyOptions = {
  /** The host's address as `host:port`, as the proxy reaches it. */
  host: string
  /** Default `PROXY_PORT` and `FORWARD_PORT`. */
  proxyPort?: number
  forwardPort?: number
}

/**
 * A provider computer's only way out of its network, run beside it on the
 * Docker host:
 *
 * - `PROXY_PORT` is an HTTP proxy (CONNECT for HTTPS) to the public internet
 *   only, never the Docker host, the LAN or a tailnet.
 * - `FORWARD_PORT` passes the computer's WebSocket to the host's
 *   `CONNECT_PATH` and nothing else, so a computer can't use the rest of the
 *   host's API.
 */
export function startProxy(options: ProxyOptions) {
  const [hostName, hostPort] = splitHost(options.host)

  const proxy = createServer((incoming, outgoing) => {
    // A plain-HTTP request names its whole URL.
    const url = URL.canParse(incoming.url ?? '')
      ? new URL(incoming.url!)
      : undefined
    if (url?.protocol !== 'http:') {
      outgoing.writeHead(400).end()
      return
    }
    const onward = request(
      {
        method: incoming.method,
        path: url.pathname + url.search,
        headers: withoutProxyHeaders(incoming),
        createConnection: () =>
          connectPublic(url.hostname, Number(url.port || 80)),
      },
      (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers)
        response.pipe(outgoing)
      },
    )
    onward.on('error', () => {
      if (!outgoing.headersSent) {
        outgoing.writeHead(403)
      }
      outgoing.end()
    })
    incoming.pipe(onward)
  })
  proxy.on('connect', (incoming: IncomingMessage, socket: Duplex, head) => {
    const target = URL.canParse(`http://${incoming.url}`)
      ? new URL(`http://${incoming.url}`)
      : undefined
    if (!target?.port) {
      return refuse(socket, '400 Bad Request')
    }
    const onward = connectPublic(target.hostname, Number(target.port))
    onward.once('connect', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      onward.write(head)
      join(socket, onward)
    })
    onward.once('error', () => refuse(socket, '403 Forbidden'))
    socket.on('error', () => onward.destroy())
  })

  const forward = createServer((_incoming, outgoing) =>
    outgoing.writeHead(404).end(),
  )
  forward.on('upgrade', (incoming: IncomingMessage, socket: Duplex, head) => {
    if (new URL(incoming.url ?? '/', 'http://x').pathname !== CONNECT_PATH) {
      return refuse(socket, '404 Not Found')
    }
    const onward = connect({ host: hostName, port: hostPort })
    onward.once('connect', () => {
      // The request as it came, addressed to the host.
      const lines = [`${incoming.method} ${incoming.url} HTTP/1.1`]
      for (let i = 0; i < incoming.rawHeaders.length; i += 2) {
        const [key, value] = [
          incoming.rawHeaders[i]!,
          incoming.rawHeaders[i + 1]!,
        ]
        lines.push(
          `${key}: ${key.toLowerCase() === 'host' ? options.host : value}`,
        )
      }
      onward.write(lines.join('\r\n') + '\r\n\r\n')
      onward.write(head)
      join(socket, onward)
    })
    onward.once('error', () => refuse(socket, '502 Bad Gateway'))
    socket.on('error', () => onward.destroy())
  })

  proxy.listen(options.proxyPort ?? PROXY_PORT)
  forward.listen(options.forwardPort ?? FORWARD_PORT)
  return {
    close: () => {
      proxy.close()
      forward.close()
    },
  }
}

/** `host:port`, with an IPv6 host in brackets. */
function splitHost(address: string): [string, number] {
  const match = address.match(/^(\[[^\]]+\]|[^:]+):(\d+)$/)
  if (!match) {
    throw new Error(`Expected host:port, got "${address}".`)
  }
  return [match[1]!.replace(/^\[|\]$/g, ''), Number(match[2])]
}

function withoutProxyHeaders(incoming: IncomingMessage) {
  const headers = { ...incoming.headers }
  delete headers['proxy-connection']
  delete headers['proxy-authorization']
  return headers
}
