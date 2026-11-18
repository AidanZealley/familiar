import { execFile } from 'node:child_process'
import { homedir, networkInterfaces } from 'node:os'
import { dirname } from 'node:path'
import { promisify } from 'node:util'
import type { FamiliarId } from '@familiar-ai/core'
import { AGENT_SOCKET, PROXY_PORT } from '../agent/socket.ts'
import { OWN_ADDRESSES, PROXY_SOCKET } from './proxy.ts'

/**
 * Where every Docker CLI process runs: the user's home, never inside an
 * install, data or temporary folder, which a process outliving the host
 * would keep from being deleted on Windows.
 */
export const DOCKER_CWD = homedir()
/** Where a computer's home is: its disk, kept while it sleeps. */
export const HOME = '/home/computer'
const HOST_LABEL = 'familiar-ai.host'
const FAMILIAR_LABEL = 'familiar-ai.familiar'

const exec = promisify(execFile)

/** Runs the Docker CLI, which honours `DOCKER_HOST` (such as `ssh://…`) and Docker contexts. */
export const docker = async (...args: string[]) =>
  (
    await exec('docker', args, { cwd: DOCKER_CWD, maxBuffer: 16 * 1024 * 1024 })
  ).stdout.trim()

/** Why Docker couldn't do something, for the person or the model. */
export function reasonOf(error: unknown) {
  const { code, stderr } = error as { code?: string; stderr?: string }
  if (code === 'ENOENT') {
    return 'Install Docker to give Familiars computers.'
  }
  return (
    stderr?.trim() || (error instanceof Error ? error.message : String(error))
  )
}

/** A container or volume this host made: its Familiar's, unless shared. */
export type Owned = { name: string; familiar?: FamiliarId; running?: boolean }

/**
 * What one host ID has on the Docker engine, and how each piece is made:
 * a container and a home volume per Familiar, and the shared proxy with its
 * socket's volume. Everything is named and labelled with the host ID, and
 * found only by its labels, never by name, so nothing another host or
 * person made is used or removed. It keeps no state: Docker is the record.
 */
export function dockerResources(
  hostId: string,
  { image, idleMs }: { image: string; idleMs: number },
) {
  const prefix = `familiar-${hostId}`
  const proxy = `${prefix}-proxy`
  /** The volume that holds the proxy's socket. */
  const proxyDir = `${prefix}-proxy-socket`
  const container = (familiar: FamiliarId) => `${prefix}-${familiar}`
  const disk = (familiar: FamiliarId) => `${container(familiar)}-home`
  /** This host's labels, and `familiar`'s, if given. */
  const labels = (familiar?: FamiliarId) => [
    `${HOST_LABEL}=${hostId}`,
    ...(familiar === undefined ? [] : [`${FAMILIAR_LABEL}=${familiar}`]),
  ]
  const labelled = (familiar?: FamiliarId) =>
    labels(familiar).flatMap((label) => ['--label', label])

  /** This host's containers or volumes, and only `familiar`'s, if given. */
  const list = async (
    kind: 'container' | 'volume',
    familiar?: FamiliarId,
  ): Promise<Owned[]> =>
    (
      await docker(
        kind,
        'ls',
        ...(kind === 'container' ? ['--all'] : []),
        ...labels(familiar).flatMap((label) => ['--filter', `label=${label}`]),
        '--format',
        kind === 'container'
          ? `{{.Names}}\t{{.Label "${FAMILIAR_LABEL}"}}\t{{.State}}`
          : `{{.Name}}\t{{.Label "${FAMILIAR_LABEL}"}}`,
      )
    )
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [name, familiar, state] = line.split('\t')
        return {
          name: name!,
          familiar: familiar ? (Number(familiar) as FamiliarId) : undefined,
          running: state === 'running',
        }
      })

  /**
   * Makes the volume `name` unless this host has it. One by that name that
   * isn't this host's fails instead of being used, as Docker would quietly
   * use it. Docker itself refuses a container's name that's taken.
   */
  const ensureVolume = async (name: string, familiar?: FamiliarId) => {
    if ((await list('volume', familiar)).some((owned) => owned.name === name)) {
      return
    }
    if (
      await docker('volume', 'inspect', name).then(
        () => true,
        () => false,
      )
    ) {
      throw new Error(
        `Docker already has a volume called ${name} that this Familiar host didn't make, so it won't use or remove it. Rename or remove it, or give this host another hostId.`,
      )
    }
    await docker('volume', 'create', ...labelled(familiar), name)
  }

  return {
    container,
    /** This host's containers, and only `familiar`'s, if given. */
    containers: (familiar?: FamiliarId) => list('container', familiar),
    volumes: () => list('volume'),

    /**
     * Makes the proxy again, and its socket's volume if missing, so it runs
     * this host's image and knows this machine's current addresses (with
     * `DOCKER_HOST` on another machine, this one's, not the engine's).
     */
    remakeProxy: async () => {
      await ensureVolume(proxyDir)
      if ((await list('container')).some(({ name }) => name === proxy)) {
        await docker('rm', '--force', proxy)
      }
      const own = Object.values(networkInterfaces()).flatMap((addresses) =>
        (addresses ?? []).map(({ address }) => address),
      )
      await docker(
        'run',
        '--detach',
        '--name',
        proxy,
        ...labelled(),
        '--restart',
        'unless-stopped',
        '--init',
        // Its way out is Docker's default network; it listens only on its
        // socket, so nothing there can use it.
        '--volume',
        `${proxyDir}:${dirname(PROXY_SOCKET)}`,
        '--env',
        `${OWN_ADDRESSES}=${own.join(',')}`,
        '--entrypoint',
        'node',
        image,
        '/agent/dist/docker/proxy-main.js',
      )
    },

    /**
     * Makes `familiar`'s container, stopped, on the disk it has, if any. It
     * has no network: its agent passes its local proxy port on to the
     * proxy's socket, its only way out. Its agent ends itself after `idleMs`
     * without a call, which stops it: it sleeps.
     */
    createComputer: async (familiar: FamiliarId) => {
      await ensureVolume(disk(familiar), familiar)
      const proxyUrl = `http://127.0.0.1:${PROXY_PORT}`
      await docker(
        'create',
        '--name',
        container(familiar),
        '--hostname',
        `familiar-${familiar}`,
        ...labelled(familiar),
        '--network',
        'none',
        '--init',
        // So one Familiar can't starve the machine or the others.
        '--memory',
        '4g',
        '--cpus',
        '2',
        '--pids-limit',
        '512',
        // Chromium's shared memory; Docker's default 64 MB crashes big pages.
        '--shm-size',
        '1g',
        '--volume',
        `${disk(familiar)}:${HOME}`,
        '--volume',
        `${proxyDir}:${dirname(PROXY_SOCKET)}:ro`,
        ...['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy'].flatMap(
          (name) => ['--env', `${name}=${proxyUrl}`],
        ),
        image,
        '--idle-ms',
        String(idleMs),
        '--proxy-socket',
        PROXY_SOCKET,
      )
    },

    /**
     * Whether `familiar`'s container was made from another image than the
     * one `image` names now, compared by ID, so a moved tag counts too.
     */
    outdated: async (familiar: FamiliarId) => {
      const [made, current] = await Promise.all([
        docker(
          'container',
          'inspect',
          '--format',
          '{{.Image}}',
          container(familiar),
        ),
        docker('image', 'inspect', '--format', '{{.Id}}', image),
      ])
      return made !== current
    },

    /**
     * The command whose stdio reaches `familiar`'s agent. `socat` retries
     * for up to a minute while a computer that has just started opens its
     * socket.
     */
    agentCommand: (familiar: FamiliarId) => [
      'exec',
      '--interactive',
      container(familiar),
      'socat',
      '-',
      `UNIX-CONNECT:${AGENT_SOCKET},retry=600,interval=0.1`,
    ],
  }
}
