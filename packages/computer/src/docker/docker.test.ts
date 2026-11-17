import { execFile, execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { networkInterfaces } from 'node:os'
import { promisify } from 'node:util'
import { openWorkspace, type FamiliarId } from '@familiar-ai/core'
import type { JsonObject } from '@familiar-ai/core/extensions'
import { replyTo } from '@familiar-ai/core/diagnostics'
import { createModels, type Context } from '@familiar-ai/core/models'
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@familiar-ai/core/models/faux'
import { MemoryStorage } from '@familiar-ai/core/storage/memory'
import { expect, onTestFinished, test, vi } from 'vitest'
import { computer } from '../index.ts'
import { COMPUTER_IMAGE, dockerHost } from './index.ts'

// Familiars' Docker computers end to end, on this machine's Docker with the
// image built (`pnpm image`). Skipped without them. It reaches the public
// internet.

const docker = (...args: string[]) =>
  execFileSync('docker', args, { encoding: 'utf8' }).trim()
const hasImage = (() => {
  try {
    docker('image', 'inspect', COMPUTER_IMAGE)
    return true
  } catch {
    return false
  }
})()

const owner = { id: 'owner', name: 'Owner' }

/**
 * Makes `tag` a copy of the computers' image with its own ID, as another
 * release's would have, so the test never touches the real image's tags.
 */
const imageCopy = (tag: string) =>
  execFileSync('docker', ['build', '--quiet', '--tag', tag, '-'], {
    input: `FROM ${COMPUTER_IMAGE}\nLABEL familiar-ai.test=${tag}\n`,
    encoding: 'utf8',
  }).trim()

const call = (name: string, args: JsonObject) =>
  fauxAssistantMessage(fauxToolCall(name, args), { stopReason: 'toolUse' })

const lastResult = (context: Context) =>
  context.messages
    .findLast((message) => message.role === 'toolResult')
    ?.content.flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('\n') ?? ''

/** A page with a name field and a button that greets the name. */
const GREETER = `data:text/html,${encodeURIComponent(`<!doctype html><title>Greeter</title>
<label>Name <input></label>
<button onclick="document.querySelector('p').textContent = 'Hello, ' + document.querySelector('input').value">Greet</button>
<p></p>`)}`

/** The element named `name` in the latest snapshot the model was given. */
const ref = (context: Context, name: RegExp) =>
  lastResult(context).match(name)?.[1] ?? 'missing'

test.skipIf(!hasImage)(
  'a Familiar uses its Docker computer, which stays off the LAN, sleeps, wakes, reconnects and is removed',
  async () => {
    // Its own host ID, so it never touches another host's computers.
    const hostId = `test${randomBytes(3).toString('hex')}`
    // Images in a repository of its own, so removing old versions only
    // ever finds its own.
    const repository = `familiar-computer-${hostId}`
    const image = `${repository}:v1`
    imageCopy(image)
    const tags = () =>
      docker('image', 'ls', '--format', '{{.Tag}}', repository)
        .split('\n')
        .filter(Boolean)
        .sort()
    let maxComputers = 1
    const host = dockerHost({
      hostId,
      image,
      idleMs: 3000,
      maxComputers: () => maxComputers,
    })
    const labelled = (kind: string) =>
      docker(
        kind,
        'ls',
        '-q',
        ...(kind === 'container' ? ['--all'] : []),
        '--filter',
        `label=familiar-ai.host=${hostId}`,
      )
    onTestFinished(async () => {
      await host.sync([])
      for (const kind of ['container', 'volume']) {
        expect(labelled(kind)).toBe('')
      }
      for (const tag of tags()) {
        docker('image', 'rm', `${repository}:${tag}`)
      }
    })

    const faux = fauxProvider({ models: [{ id: 'faux-1' }] })
    const models = createModels()
    models.setProvider(faux.provider)
    const workspace = await openWorkspace({
      storage: new MemoryStorage(),
      models,
      chatModel: { provider: 'faux', modelId: 'faux-1' },
      timeZone: 'UTC',
      plugins: [computer({ host })],
      defaultCapabilities: { plugins: ['computer'] },
    })
    onTestFinished(() => workspace.dismiss())
    await workspace.connections.setPolicy(
      { kind: 'plugin', name: 'computer' },
      undefined,
      'allow',
    )

    // Turning the capability on gives Ada a computer, asleep until used.
    const ada = await workspace.familiars.create({ name: 'Ada' })
    const status = () => host.status(ada.id)
    await vi.waitFor(
      async () => expect(await status()).toEqual({ state: 'asleep' }),
      {
        timeout: 60_000,
        interval: 500,
      },
    )

    // A browser task, through the workspace, wakes it.
    let final = ''
    faux.setResponses([
      call('browser_navigate', { url: GREETER }),
      (context: Context) =>
        call('browser_type', {
          ref: ref(context, /textbox "Name" \[ref=(\w+)\]/),
          text: 'Ada',
        }),
      (context: Context) =>
        call('browser_click', {
          ref: ref(context, /button "Greet" \[ref=(\w+)\]/),
        }),
      (context: Context) => {
        final = lastResult(context)
        return fauxAssistantMessage('It says hello.')
      },
    ])
    const dm = (await workspace.rooms.get(
      await workspace.rooms.dm(ada.id, owner.id),
    ))!
    await replyTo(
      dm,
      await dm.post({ author: owner, text: 'Greet Ada', requestId: 'greet' }),
    )
    expect(final).toContain('Hello, Ada')
    expect(await status()).toEqual({ state: 'running' })

    /** Runs `command` on `familiar`'s computer: its output and exit status. */
    const run = async (command: string, familiar: FamiliarId = ada.id) => {
      const result = await host.call(familiar, 'run_command', {
        command,
        timeout_seconds: 30,
      })
      return result.content
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join('\n')
    }

    // No network, only the proxy: the public internet, for the browser and
    // the shell, but nothing on the Docker host's addresses (its LAN,
    // tailnet and Docker's bridges), through the proxy or around it.
    // No interface up but loopback. Some kernels (Docker Desktop's) add idle
    // tunnel devices to every namespace; down, they route nothing.
    expect(
      await run(
        'for i in /sys/class/net/*; do [ $(($(cat $i/flags) & 1)) = 1 ] && basename $i; done; true',
      ),
    ).toMatch(/^lo\s+Exit code 0/)
    const page = await host.call(ada.id, 'browser_navigate', {
      url: 'https://example.com/',
    })
    expect(JSON.stringify(page.content)).toContain('Example Domain')
    expect(
      await run('curl -sS -o /dev/null -w "%{http_code}" https://example.com/'),
    ).toMatch(/^200/)
    const listening = createServer((_, response) => response.end('reached'))
    listening.listen(0, '0.0.0.0')
    await once(listening, 'listening')
    onTestFinished(() => void listening.close())
    const { port } = listening.address() as AddressInfo
    const addresses = Object.values(networkInterfaces())
      .flat()
      .flatMap((address) =>
        address?.family === 'IPv4' && !address.internal
          ? [address.address]
          : [],
      )
    for (const address of addresses) {
      const url = `http://${address}:${port}/`
      expect(await run(`curl -sS -m 5 ${url}`)).not.toContain('reached')
      expect(await run(`curl -sS -m 5 --noproxy '*' ${url}`)).not.toContain(
        'reached',
      )
    }

    // A restart ends the exec the host talks through; the next call
    // connects again.
    expect(await run('echo kept > marker.txt')).toMatch(/Exit code 0/)
    await promisify(execFile)('docker', [
      'restart',
      `familiar-${hostId}-${ada.id}`,
    ])
    expect(await run('cat marker.txt')).toMatch(/kept\s+Exit code 0/)

    // Idle, it sleeps; the next call wakes it, saying so, its disk as it was.
    await vi.waitFor(
      async () => expect(await status()).toEqual({ state: 'asleep' }),
      {
        timeout: 30_000,
        interval: 500,
      },
    )
    const woken = await run('cat marker.txt')
    expect(woken).toMatch(/was asleep/)
    expect(woken).toMatch(/kept/)

    // Past the limit, another Familiar gets no computer and is told why,
    // until the limit, read live, is raised.
    const other = (ada.id + 1000) as FamiliarId
    expect(await host.status(other)).toEqual({
      state: 'unavailable',
      reason: expect.stringMatching(/allows 1 computer at most/),
    })
    expect(await run('true', other)).toMatch(/couldn't start.*allows 1/s)
    maxComputers = 2
    expect(await host.status(other)).toEqual({ state: 'none' })

    // Turning the capability off removes its computer and disk.
    await ada.setCapabilities({ plugins: [] })
    await vi.waitFor(
      () => {
        for (const kind of ['container', 'volume']) {
          expect(
            docker(
              kind,
              'ls',
              '-q',
              ...(kind === 'container' ? ['--all'] : []),
              '--filter',
              `label=familiar-ai.familiar=${ada.id}`,
              '--filter',
              `label=familiar-ai.host=${hostId}`,
            ),
          ).toBe('')
        }
      },
      { timeout: 30_000, interval: 500 },
    )
    expect(await status()).toEqual({ state: 'none' })

    // A resource named as Bo's disk would be, that this host didn't make,
    // is neither used nor removed.
    const bo = await workspace.familiars.create({
      name: 'Bo',
      capabilities: { plugins: [] },
    })
    const theirs = `familiar-${hostId}-${bo.id}-home`
    docker('volume', 'create', theirs)
    onTestFinished(() => void docker('volume', 'rm', theirs))
    expect(await run('true', bo.id)).toMatch(
      /couldn't start.*volume called .*-home that this Familiar host didn't make/s,
    )
    await host.sync([])
    expect(docker('volume', 'ls', '-q', '--filter', `name=^${theirs}$`)).toBe(
      theirs,
    )

    // After an update, a host on the new version removes old versions no
    // container uses, keeping the one Cy's computer and the proxy use...
    const cy = (ada.id + 2000) as FamiliarId
    await host.sync([cy])
    expect(await run('echo kept > marker.txt', cy)).toMatch(/Exit code 0/)
    await vi.waitFor(
      async () => expect(await host.status(cy)).toEqual({ state: 'asleep' }),
      { timeout: 30_000, interval: 500 },
    )
    imageCopy(`${repository}:unused`)
    const v2 = imageCopy(`${repository}:v2`)
    const updated = dockerHost({ hostId, image: `${repository}:v2` })
    await vi.waitFor(() => expect(tags()).toEqual(['v1', 'v2']), {
      timeout: 30_000,
      interval: 500,
    })
    // ...then wakes Cy's computer on the new one, its disk as it was, after
    // which nothing uses the old one.
    const updatedRun = await updated.call(cy, 'run_command', {
      command: 'cat marker.txt',
      timeout_seconds: 30,
    })
    expect(JSON.stringify(updatedRun.content)).toMatch(/was asleep.*kept/s)
    expect(
      docker(
        'container',
        'inspect',
        '--format',
        '{{.Image}}',
        `familiar-${hostId}-${cy}`,
      ),
    ).toBe(v2)
    await vi.waitFor(() => expect(tags()).toEqual(['v2']), {
      timeout: 30_000,
      interval: 500,
    })
  },
  240_000,
)
