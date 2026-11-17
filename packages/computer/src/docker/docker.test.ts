import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { networkInterfaces, tmpdir } from 'node:os'
import { resolve } from 'node:path'
import type { Context } from '@familiar-ai/core/models'
import { fauxAssistantMessage } from '@familiar-ai/core/models/faux'
import { expect, onTestFinished, test, vi } from 'vitest'
import { openComputers } from '../index.ts'
import {
  call,
  greet,
  GREETER,
  lastResult,
  ReopenableStorage,
  serveHost,
  testModel,
} from '../testing.ts'
import { dockerProvider } from './index.ts'

// A Familiar's Docker computer end to end, on this machine's Docker with the
// agent's image built (`pnpm --filter @familiar-ai/computer image`). Skipped
// without them. It reaches the public internet.

const docker = (...args: string[]) =>
  execFileSync('docker', args, { encoding: 'utf8' }).trim()
const hasImage = (() => {
  try {
    return docker('image', 'ls', '-q', 'familiar-computer') !== ''
  } catch {
    return false
  }
})()

/** This machine's LAN address, which a computer must not reach. */
const lanAddress = Object.values(networkInterfaces())
  .flat()
  .find(
    (address) =>
      address?.family === 'IPv4' &&
      !address.internal &&
      !address.address.startsWith('172.'),
  )?.address

test.skipIf(!hasImage)(
  'a Docker computer does a browser task, stays off the LAN, sleeps, wakes, and is kept to its Familiar',
  async () => {
    const hostId = `test${randomBytes(3).toString('hex')}`
    const dir = await mkdtemp(resolve(tmpdir(), 'familiar-docker-'))
    const { faux, models } = testModel()
    const computers = openComputers({
      path: resolve(dir, 'computers.json'),
      keyPath: resolve(dir, 'vault.key'),
      loginsDir: resolve(dir, 'logins'),
      provider: dockerProvider({
        hostId,
        // Set once the host has its port: the proxy starts on first use.
        get hostAddress() {
          return `host.docker.internal:${host.port}`
        },
      }),
      idleMs: 3000,
    })
    // Containers reach the host through Docker's bridge.
    const host = await serveHost({
      computers,
      models,
      storage: new ReopenableStorage(),
      hostname: '0.0.0.0',
    })
    const stopFollowing = await computers.follow(host.workspace)
    const ours = () =>
      docker('ps', '-aq', '--filter', `label=familiar-ai.host=${hostId}`)
    onTestFinished(async () => {
      await stopFollowing()
      await host.close()
      const left = ours()
      if (left) {
        docker('rm', '-f', ...left.split('\n'))
      }
      for (const kind of ['network', 'volume']) {
        const left = docker(
          kind,
          'ls',
          '-q',
          '--filter',
          `label=familiar-ai.host=${hostId}`,
        )
        if (left) {
          docker(kind, 'rm', ...left.split('\n'))
        }
      }
      await rm(dir, { recursive: true, force: true })
    })
    const container = `familiar-${hostId}-${host.familiar}`
    const results: string[] = []
    const note = (next: ReturnType<typeof call>) => (context: Context) => {
      results.push(lastResult(context))
      return next
    }
    /** Asks Ada to run `command` on her computer: its result. */
    const run = async (command: string) => {
      faux.setResponses([
        call('run_command', { command, timeout_seconds: 30 }),
        note(fauxAssistantMessage('Done.')),
      ])
      await host.reply(await host.ask(command))
      return results.at(-1)!
    }

    // Given a computer, asleep until a call needs it.
    const given = await host.api('', {
      method: 'POST',
      body: JSON.stringify({ provider: true }),
    })
    expect(await given.json()).toEqual({ status: 'asleep' })

    // A browser task wakes it.
    let final = ''
    faux.setResponses([
      ...greet(`data:text/html,${encodeURIComponent(GREETER)}`),
      (context) => {
        final = lastResult(context)
        return fauxAssistantMessage('It says hello.')
      },
    ])
    await host.reply(await host.ask('Greet Ada'))
    expect(final).toContain('Hello, Ada')

    // The public internet, through the proxy, but not the host or its LAN,
    // by the proxy or around it: through Docker's bridges, the computer's
    // own network's gateway among them, or the LAN.
    expect(
      await run('curl -sS -o /dev/null -w "%{http_code}" https://example.com/'),
    ).toMatch(/200/)
    const subnet = docker(
      'network',
      'inspect',
      `${container}-network`,
      '--format',
      '{{(index .IPAM.Config 0).Subnet}}',
    )
    const gateway = subnet.replace(/\.0\/\d+$/, '.1')
    expect(gateway).toMatch(/^\d+\.\d+\.\d+\.1$/)
    for (const address of ['172.17.0.1', gateway, lanAddress].filter(Boolean)) {
      const url = `http://${address}:${host.port}/api/computers/${host.familiar}`
      expect(await run(`curl -fsS -m 5 ${url}`)).toMatch(/Exit code [1-9]/)
      expect(await run(`curl -fsS -m 5 --noproxy '*' ${url}`)).toMatch(
        /Exit code [1-9]/,
      )
    }
    // The forward to the host passes the computer's connection only.
    expect(
      await run(
        `curl -fsS -m 5 --noproxy '*' http://familiar-${hostId}-proxy:3129/api/computers/${host.familiar}`,
      ),
    ).toMatch(/error: 404/)
    expect(await run('echo kept > marker.txt')).toMatch(/Exit code 0/)

    // Idle, it sleeps; the next call wakes it, its disk as it was.
    await vi.waitFor(async () => expect(await host.status()).toBe('asleep'), {
      timeout: 30_000,
      interval: 500,
    })
    expect(await run('cat marker.txt')).toMatch(/kept/)

    // The check deletes a computer, or a disk left behind, whose Familiar
    // has none, and makes a missing one again on its disk. Adding a Familiar
    // runs it.
    const label = ['--label', `familiar-ai.host=${hostId}`]
    docker(
      'volume',
      'create',
      ...label,
      '--label',
      'familiar-ai.familiar=998',
      `familiar-${hostId}-998-home`,
    )
    docker(
      'create',
      ...label,
      '--label',
      'familiar-ai.familiar=999',
      '--name',
      `familiar-${hostId}-999`,
      'familiar-computer',
    )
    docker('rm', '-f', container)
    await host.workspace.familiars.create({ name: 'Bo' })
    await vi.waitFor(
      () => {
        const names = docker(
          'ps',
          '-a',
          '--filter',
          `label=familiar-ai.host=${hostId}`,
          '--format',
          '{{.Names}}',
        ).split('\n')
        expect(names).toContain(container)
        expect(names).not.toContain(`familiar-${hostId}-999`)
        expect(
          docker(
            'volume',
            'ls',
            '-q',
            '--filter',
            `name=^familiar-${hostId}-998`,
          ),
        ).toBe('')
      },
      { timeout: 30_000, interval: 500 },
    )
    expect(await run('cat marker.txt')).toMatch(/kept/)

    // Removing it deletes the container and its disk.
    await host.api('', { method: 'DELETE' })
    expect(await host.status()).toBe('none')
    expect(docker('ps', '-aq', '--filter', `name=^${container}$`)).toBe('')
    expect(
      docker('volume', 'ls', '-q', '--filter', `name=^${container}-home$`),
    ).toBe('')
    expect(
      docker('network', 'ls', '-q', '--filter', `name=^${container}-network$`),
    ).toBe('')
  },
  240_000,
)
