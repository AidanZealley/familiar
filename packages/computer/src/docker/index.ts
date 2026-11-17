import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { FamiliarId } from '@familiar-ai/core'
import type { ComputerProvider } from '../host/computers.ts'
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
 * Computers sit on an internal network with no way out but a proxy beside
 * them, which reaches the public internet only, never the Docker host, its
 * LAN or a tailnet, and passes the computer's connection to the host. Uses
 * the Docker CLI, so `DOCKER_HOST=ssh://…` manages a remote engine the same
 * way.
 */
export function dockerProvider(options: DockerOptions): ComputerProvider {
  const image = options.image ?? 'familiar-computer'
  const prefix = `familiar-${options.hostId}`
  const network = `${prefix}-computers`
  const outside = `${prefix}-outside`
  const proxy = `${prefix}-proxy`
  const container = (familiar: FamiliarId) => `${prefix}-${familiar}`
  const ours = ['--label', `${HOST_LABEL}=${options.hostId}`]

  /**
   * The computers' internal network, the proxy's way out, and the proxy,
   * made once each time the host starts, so the proxy follows the host's
   * address and image.
   */
  let prepared: Promise<void> | undefined
  const prepare = () =>
    (prepared ??= (async () => {
      for (const [name, internal] of [
        [network, true],
        [outside, false],
      ] as const) {
        if (
          !(await docker('network', 'ls', '-q', '--filter', `name=^${name}$`))
        ) {
          await docker(
            'network',
            'create',
            ...(internal ? ['--internal'] : []),
            ...ours,
            name,
          )
        }
      }
      await docker('rm', '-f', proxy)
      await docker(
        'run',
        '--detach',
        '--name',
        proxy,
        ...ours,
        '--restart',
        'unless-stopped',
        '--init',
        // Its route out; the internal network is how computers reach it.
        '--network',
        outside,
        '--network',
        network,
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

  const create = async (familiar: FamiliarId, token: string) => {
    await prepare()
    const proxyUrl = `http://${proxy}:${PROXY_PORT}`
    await docker(
      'create',
      '--name',
      container(familiar),
      '--hostname',
      `familiar-${familiar}`,
      ...ours,
      '--label',
      `${FAMILIAR_LABEL}=${familiar}`,
      '--network',
      network,
      '--init',
      '--volume',
      `${container(familiar)}-home:${HOME}`,
      '--env',
      `FAMILIAR_COMPUTER_LINK=ws://${proxy}:${FORWARD_PORT}${CONNECT_PATH}#${token}`,
      ...['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy'].flatMap(
        (name) => ['--env', `${name}=${proxyUrl}`],
      ),
      image,
    )
  }

  const list = async () => {
    const lines = await docker(
      'ps',
      '--all',
      '--filter',
      `label=${HOST_LABEL}=${options.hostId}`,
      '--filter',
      `label=${FAMILIAR_LABEL}`,
      '--format',
      `{{.Label "${FAMILIAR_LABEL}"}} {{.State}}`,
    )
    return new Map(
      lines
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [familiar, state] = line.split(' ')
          return [
            Number(familiar) as FamiliarId,
            { running: state === 'running' },
          ]
        }),
    )
  }

  return {
    list,
    create: async (familiar, token) => {
      if (!(await list()).has(familiar)) {
        await create(familiar, token)
      }
    },
    wake: async (familiar, token) => {
      const found = (await list()).get(familiar)
      if (!found) {
        await create(familiar, token)
      } else {
        await prepare()
      }
      if (!found?.running) {
        await docker('start', container(familiar))
      }
    },
    sleep: async (familiar) => {
      await docker('stop', container(familiar))
    },
    remove: async (familiar) => {
      await docker('rm', '--force', container(familiar))
      await docker('volume', 'rm', '--force', `${container(familiar)}-home`)
    },
  }
}
