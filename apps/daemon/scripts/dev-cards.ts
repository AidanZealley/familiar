// One command to try cards with a real model: a fresh dev daemon (its own
// data directory and port, never the installed assistant's), the web app
// pointed at it, and the pretend Home Assistant to add as a connection.
// Sign in with ChatGPT in the app. Ctrl-C stops all three.
import { spawn, type ChildProcess } from 'node:child_process'
import { homedir, networkInterfaces } from 'node:os'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../../..')
const dataDir =
  process.env.FAMILIAR_DATA_DIR ??
  resolve(homedir(), '.local/share/familiar-gencn-dev')
const installed = resolve(
  process.env.XDG_DATA_HOME ?? resolve(homedir(), '.local/share'),
  'familiar',
)
if (resolve(dataDir) === installed) {
  throw new Error(`Refusing ${dataDir}: it's the installed assistant's data.`)
}
const daemonPort = Number(process.env.FAMILIAR_PORT ?? 4337)
const webPort = Number(process.env.WEB_PORT ?? 5187)
const homePort = Number(process.env.HOME_MCP_PORT ?? 8125)
if (daemonPort === 4317) {
  throw new Error('4317 is the installed assistant: choose another port.')
}

const children: ChildProcess[] = []
const run = (name: string, command: string, args: string[], env = {}) => {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n').filter(Boolean)) {
        console.log(`[${name}] ${line}`)
      }
    })
  }
  child.on('exit', (code) => {
    console.log(`[${name}] exited${code ? ` with ${code}` : ''}`)
    stop()
  })
  children.push(child)
}
const stop = () => {
  for (const child of children) {
    child.kill()
  }
  process.exit()
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)

run('home', 'node', ['apps/daemon/src/demo/home-server.ts'], {
  HOME_MCP_PORT: String(homePort),
})
run('daemon', 'node', ['--watch', 'apps/daemon/src/cli.ts', 'serve'], {
  FAMILIAR_DATA_DIR: dataDir,
  FAMILIAR_PORT: String(daemonPort),
  // Reachable over the LAN and the tailnet, like the web app.
  FAMILIAR_HOST: '0.0.0.0',
})
run(
  'web',
  'pnpm',
  [
    '--filter',
    '@familiar-ai/web',
    'exec',
    'vite',
    '--port',
    String(webPort),
    '--strictPort',
  ],
  { FAMILIAR_API: `http://127.0.0.1:${daemonPort}` },
)

// Tailscale's addresses are 100.64.0.0/10; docker's bridge isn't the LAN.
const addresses = Object.entries(networkInterfaces()).flatMap(([name, list]) =>
  (list ?? [])
    .filter((a) => a.family === 'IPv4' && !a.internal)
    .map((a) => ({ name, address: a.address })),
)
const tailnet = addresses.filter(({ address }) =>
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(address),
)
const lan = addresses.filter(
  (a) =>
    !tailnet.includes(a) &&
    !a.name.startsWith('docker') &&
    !a.name.startsWith('br-'),
)
setTimeout(() => {
  console.log(`
Cards dev instance (data: ${dataDir})
  Web, LAN:     ${lan.map(({ address }) => `http://${address}:${webPort}`).join('  ') || '-'}
  Web, tailnet: ${tailnet.map(({ address }) => `http://${address}:${webPort}`).join('  ') || '-'}
  Daemon API:   http://127.0.0.1:${daemonPort}

Then, in the app:
  1. Sign in with ChatGPT.
  2. Settings → Connections → add an MCP server:
       name  home-assistant
       type  HTTP
       URL   http://127.0.0.1:${homePort}/mcp
       auth  none
  3. Turn home-assistant on for your Familiar (Cards is on by default).
  4. Ask it for controls, e.g. "Show me controls for the living room".
`)
}, 4000)
