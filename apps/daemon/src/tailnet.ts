import { execFileSync } from 'node:child_process'
import { userInfo } from 'node:os'

type Publication = {
  TCP?: Record<string, { HTTPS?: boolean }>
  Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }>
  AllowFunnel?: Record<string, boolean>
}

const httpsPort = '10000'
const target = (port: number) => `http://127.0.0.1:${port}`

function tailscale(...args: string[]) {
  const run = (command: string) =>
    execFileSync(command, args, {
      encoding: 'utf8',
      timeout: 15000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  try {
    return run('tailscale')
  } catch (error) {
    if (
      process.platform === 'darwin' &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return run('/Applications/Tailscale.app/Contents/MacOS/Tailscale')
    }
    throw error
  }
}

function report(error: unknown) {
  if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
    console.log(
      'Install Tailscale to reach Familiar from your other devices: https://tailscale.com/download',
    )
    return
  }
  const message = error instanceof Error ? error.message : String(error)
  console.log(`Tailscale setup skipped: ${message}`)
  if (
    process.platform === 'linux' &&
    /access denied|permission denied|not permitted/i.test(message)
  ) {
    console.log(
      `Run sudo tailscale set --operator=${userInfo().username}, then run familiar again.`,
    )
  }
}

export function publish(port: number): string | undefined {
  try {
    const status = JSON.parse(tailscale('status', '--json')) as {
      BackendState?: string
      Self?: { DNSName?: string }
    }
    if (status.BackendState !== 'Running' || !status.Self?.DNSName) {
      console.log(
        'Sign in to Tailscale, then run familiar again for access from other devices.',
      )
      return
    }
    const host = `${status.Self.DNSName.replace(/\.$/, '')}:${httpsPort}`
    const publication = JSON.parse(
      tailscale('serve', 'status', '--json'),
    ) as Publication
    const handlers = publication.Web?.[host]?.Handlers
    if (publication.AllowFunnel?.[host]) {
      throw new Error(
        'Port 10000 has public Funnel access. Disable it before using Familiar there.',
      )
    }
    if (
      handlers?.['/']?.Proxy === target(port) &&
      publication.TCP?.[httpsPort]?.HTTPS
    ) {
      return `https://${host}`
    }
    // This port can belong to another app. Setup must not replace its route.
    if (
      publication.TCP?.[httpsPort] ||
      Object.keys(publication.Web ?? {}).some((key) =>
        key.endsWith(`:${httpsPort}`),
      )
    ) {
      throw new Error(
        'Tailscale port 10000 is already configured. Keep that configuration or free the port and run familiar again.',
      )
    }
    tailscale('serve', '--bg', `--https=${httpsPort}`, '--yes', target(port))
    return `https://${host}`
  } catch (error) {
    report(error)
  }
}

export function unpublish(port: number) {
  try {
    const publication = JSON.parse(
      tailscale('serve', 'status', '--json'),
    ) as Publication
    const handlers = Object.entries(publication.Web ?? {}).find(
      ([host, route]) =>
        host.endsWith(`:${httpsPort}`) &&
        route.Handlers?.['/']?.Proxy === target(port),
    )?.[1].Handlers
    if (handlers?.['/']?.Proxy !== target(port)) {
      return
    }
    if (Object.keys(handlers).length !== 1) {
      throw new Error(
        "Port 10000 also has other routes. Remove Familiar's route manually to preserve them.",
      )
    }
    tailscale('serve', `--https=${httpsPort}`, 'off')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.log(
        `Could not remove the Tailscale publication: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}
