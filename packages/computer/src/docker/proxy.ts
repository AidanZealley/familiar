import { lookup } from 'node:dns'
import { createServer, request, type IncomingMessage } from 'node:http'
import { BlockList, connect, isIP, Socket, type LookupFunction } from 'node:net'
import type { Duplex } from 'node:stream'

/** The proxy's port, for HTTP and HTTPS (CONNECT) to the public internet. */
export const PROXY_PORT = 3128

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

/** A connection that fails with `error` as soon as it's listened to. */
function failed(error: Error) {
  const socket = new Socket()
  process.nextTick(() => socket.destroy(error))
  return socket
}

/** A connection to `host:port` on the public internet only. */
function connectPublic(host: string, port: number) {
  const name = host.replace(/^\[|\]$/g, '')
  // `connect` throws on a port it can't use.
  if (!(port > 0 && port < 65536)) {
    return failed(new Error(`${port} isn't a port.`))
  }
  // `connect` looks up names only, so an address is checked here.
  if (isIP(name) && !isPublic(name)) {
    return failed(notPublicError(host))
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

/**
 * A Docker computer's only way out of its network, run beside it: an HTTP
 * proxy (CONNECT for HTTPS) on `port` to the public internet only, never the
 * Docker host, the LAN or a tailnet.
 */
export function startProxy(port = PROXY_PORT) {
  const proxy = createServer((incoming, outgoing) => {
    // A plain-HTTP request names its whole URL.
    const url = URL.parse(incoming.url ?? '')
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
        const status = response.statusCode ?? 0
        // `writeHead` throws on a status outside these.
        if (status < 100 || status > 599) {
          response.destroy()
          outgoing.writeHead(502).end()
          return
        }
        response.on('error', () => outgoing.destroy())
        outgoing.writeHead(status, response.headers)
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
    // Node leaves a socket it hands over without an error listener.
    socket.on('error', () => socket.destroy())
    const target = URL.parse(`http://${incoming.url}`)
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
    socket.on('close', () => onward.destroy())
  })

  proxy.listen(port)
  return proxy
}

function withoutProxyHeaders(incoming: IncomingMessage) {
  const headers = { ...incoming.headers }
  delete headers['proxy-connection']
  delete headers['proxy-authorization']
  return headers
}
