import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { FamiliarId } from '@familiar-ai/core'
import type { ComputerProvider, ProvidedComputer } from '../host/computers.ts'
import { CONNECT_PATH, FORWARD_PORT, PROXY_PORT } from './proxy.ts'

export type DockerOptions = {
  /**
   * This host's ID, in the name of everything it makes, so Familiar hosts
   * sharing a Docker engine leave each other's computers alone.
   */
  hostId: string
  /**
   * The host as `host:port`, as the Docker host reaches it: such as
   * `host.docker.internal:4317` when Docker runs on the same machine (the
   * host must listen on an address containers can reach, not only
   * 127.0.0.1), or its LAN or tailnet address when Docker runs elsewhere.
   */
  hostAddress: string
  /** The agent's image, built from this package's Dockerfile. Default `familiar-computer`. */
  image?: string
}

const exec = promisify(execFile)
/** Where a computer's home is: its disk, kept while it sleeps. */
const HOME = '/home/computer'
const HOST_LABEL = 'familiar-ai.host'
const FAMILIAR_LABEL = 'familiar-ai.familiar'

/** Runs the Docker CLI, which honours `DOCKER_HOST` (such as `ssh://…`) and Docker contexts. */
const docker = async (...args: string[]) =>
  (await exec('docker', args, { maxBuffer: 16 * 1024 * 1024 })).stdout.trim()

/**
 * Familiars' computers as Docker containers, one each, named by their
 * Familiar's ID. Docker owns whether each is running: a sleeping computer is a
 * stopped container, and its disk is a volume that outlives the container.
 * Each computer runs the agent image, which connects to the host with its
 * pairing token as any paired machine does.
 *
 * Each computer has an internal network of its own, with no way out but a
 * proxy that joins every computer's network. The proxy reaches the public
 * internet only, never the Docker host, its LAN or a tailnet, and passes the
 * computer's connection to the host. The networks' gateways are isolated, so
 * the bridge has no address on the Docker host for a computer to reach
 * around the proxy, and computers can't reach each other.
 *
 * Uses the Docker CLI, so `DOCKER_HOST=ssh://…` manages a remote engine the
 * same way. Docker's default address pools give an engine about 30 networks;
 * `default-address-pools` in its `daemon.json` raises that.
 */
export function dockerProvider(options: DockerOptions): ComputerProvider {
  const image = options.image ?? 'familiar-computer'
  const prefix = `familiar-${options.hostId}`
  const outside = `${prefix}-outside`
  const proxy = `${prefix}-proxy`
  /** A computer's container; its disk and network are named after it. */
  const container = (familiar: FamiliarId) => `${prefix}-${familiar}`
  const disk = (familiar: FamiliarId) => `${container(familiar)}-home`
  const network = (familiar: FamiliarId) => `${container(familiar)}-network`
  const ours = ['--label', `${HOST_LABEL}=${options.hostId}`]
  const theirs = (familiar: FamiliarId) => [
    ...ours,
    '--label',
    `${FAMILIAR_LABEL}=${familiar}`,
  ]

  /**
   * The Familiars this host has a `kind` for (`container`, `volume` or
   * `network`), each with its `field`.
   */
  const owned = async (kind: string, field: string) => {
    const lines = await docker(
      kind,
      'ls',
      ...(kind === 'container' ? ['--all'] : []),
      '--filter',
      `label=${HOST_LABEL}=${options.hostId}`,
      '--filter',
      `label=${FAMILIAR_LABEL}`,
      '--format',
      `{{.Label "${FAMILIAR_LABEL}"}} {{.${field}}}`,
    )
    return lines
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [familiar, value] = line.split(' ')
        return [Number(familiar) as FamiliarId, value!] as const
      })
  }

  /**
   * The proxy's way out and the proxy, joined to every computer's network,
   * made once each time the host starts, so the proxy follows the host's
   * address and image.
   */
  let prepared: Promise<void> | undefined
  const prepare = () =>
    (prepared ??= (async () => {
      if (
        !(await docker('network', 'ls', '-q', '--filter', `name=^${outside}$`))
      ) {
        await docker('network', 'create', ...ours, outside)
      }
      await docker('rm', '--force', proxy)
      await docker(
        'run',
        '--detach',
        '--name',
        proxy,
        ...ours,
        '--restart',
        'unless-stopped',
        '--init',
        // Its route out, then each computer's network.
        '--network',
        outside,
        ...(await owned('network', 'Name')).flatMap(([, name]) => [
          '--network',
          name,
        ]),
        '--add-host',
        'host.docker.internal:host-gateway',
        '--env',
        `FAMILIAR_HOST_ADDRESS=${options.hostAddress}`,
        '--entrypoint',
        'node',
        image,
        '/agent/dist/docker/proxy-main.js',
      )
    })().catch((error) => {
      prepared = undefined
      throw error
    }))

  /** Makes `familiar`'s container, on its disk and network if they survived. */
  const create = async (familiar: FamiliarId, token: string) => {
    await prepare()
    // Making a volume that exists keeps it as it is.
    await docker('volume', 'create', ...theirs(familiar), disk(familiar))
    const name = network(familiar)
    if (!(await docker('network', 'ls', '-q', '--filter', `name=^${name}$`))) {
      await docker(
        'network',
        'create',
        '--internal',
        // No address on the Docker host, so the proxy is the only way out.
        '--opt',
        'com.docker.network.bridge.gateway_mode_ipv4=isolated',
        '--opt',
        'com.docker.network.bridge.gateway_mode_ipv6=isolated',
        ...theirs(familiar),
        name,
      )
      await docker('network', 'connect', name, proxy)
    }
    const proxyUrl = `http://${proxy}:${PROXY_PORT}`
    await docker(
      'create',
      '--name',
      container(familiar),
      '--hostname',
      `familiar-${familiar}`,
      ...theirs(familiar),
      '--network',
      name,
      '--init',
      '--volume',
      `${disk(familiar)}:${HOME}`,
      '--env',
      `FAMILIAR_COMPUTER_LINK=ws://${proxy}:${FORWARD_PORT}${CONNECT_PATH}#${token}`,
      ...['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy'].flatMap(
        (name) => ['--env', `${name}=${proxyUrl}`],
      ),
      image,
    )
  }

  const list = async () => {
    const found = new Map<FamiliarId, ProvidedComputer>()
    for (const kind of ['volume', 'network']) {
      for (const [familiar] of await owned(kind, 'Name')) {
        found.set(familiar, 'remains')
      }
    }
    for (const [familiar, state] of await owned('container', 'State')) {
      found.set(familiar, state === 'running' ? 'running' : 'stopped')
    }
    return found
  }

  return {
    list,
    create: async (familiar, token) => {
      const found = (await list()).get(familiar)
      if (found !== 'running' && found !== 'stopped') {
        await create(familiar, token)
      }
    },
    wake: async (familiar, token) => {
      const found = (await list()).get(familiar)
      if (found === 'running' || found === 'stopped') {
        await prepare()
      } else {
        await create(familiar, token)
      }
      if (found !== 'running') {
        await docker('start', container(familiar))
      }
    },
    sleep: async (familiar) => {
      await docker('stop', container(familiar))
    },
    // Each step succeeds when what it removes is already gone.
    remove: async (familiar) => {
      await docker('rm', '--force', container(familiar))
      await docker('volume', 'rm', '--force', disk(familiar))
      await docker('network', 'disconnect', '--force', network(familiar), proxy)
        // Not connected, or either is gone.
        .catch(() => {})
      await docker('network', 'rm', '--force', network(familiar))
    },
  }
}
