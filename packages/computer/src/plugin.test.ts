import {
  memorySecrets,
  openWorkspace,
  type FamiliarId,
} from '@familiar-ai/core'
import type { JsonObject } from '@familiar-ai/core/extensions'
import { replyTo } from '@familiar-ai/core/diagnostics'
import { createModels, type Context } from '@familiar-ai/core/models'
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@familiar-ai/core/models/faux'
import { createHttpApi } from '@familiar-ai/core/http'
import { MemoryStorage } from '@familiar-ai/core/storage/memory'
import { expect, onTestFinished, test } from 'vitest'
import { computer, type ComputerHost } from './index.ts'

/** Keeps what Familiar committed when it closes, so it can reopen. */
class ReopenableStorage extends MemoryStorage {
  override async close() {}
}

const owner = { id: 'owner', name: 'Owner' }

const call = (name: string, args: JsonObject) =>
  fauxAssistantMessage(fauxToolCall(name, args), { stopReason: 'toolUse' })

/** The text of the latest tool result the model was given. */
const lastResult = (context: Context) =>
  context.messages
    .findLast((message) => message.role === 'toolResult')
    ?.content.flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('\n') ?? ''

/** A workspace whose computers are `host`, with the computer tools allowed to run without asking. */
async function open(
  host: ComputerHost,
  storage = new ReopenableStorage(),
  secrets = memorySecrets(),
) {
  const faux = fauxProvider({ models: [{ id: 'faux-1' }] })
  const models = createModels()
  models.setProvider(faux.provider)
  const workspace = await openWorkspace({
    storage,
    secrets,
    models,
    chatModel: { provider: 'faux', modelId: 'faux-1' },
    timeZone: 'UTC',
    plugins: [computer({ host })],
    defaultCapabilities: { plugins: ['computer'] },
  })
  await workspace.connections.updateToolSettings(
    { kind: 'plugin', name: 'computer' },
    'run_command',
    { askBeforeRunning: false },
  )
  const dm = async (familiar: FamiliarId) =>
    (await workspace.rooms.get(await workspace.rooms.dm(familiar, owner.id)))!
  return { faux, workspace, dm, storage }
}

/** A host that records calls and answers each with `answer`. */
function fakeHost(answer: (signal?: AbortSignal) => Promise<string>) {
  const calls: { familiar: FamiliarId; tool: string }[] = []
  const host: ComputerHost = {
    call: async (familiar, tool, _args, signal) => {
      calls.push({ familiar, tool })
      return { content: [{ type: 'text', text: await answer(signal) }] }
    },
    screen: async () => undefined,
    control: async () => {
      throw new Error('Not here.')
    },
    sync: async () => {},
    status: async () => ({ state: 'running' }),
    inspect: async (familiar) => ({ doing: [{ tool: `${familiar}'s` }] }),
    summary: async () => ({ computers: [] }),
    close: async () => {},
  }
  return { host, calls }
}

test("each call goes to the calling Familiar's own computer", async () => {
  const { host, calls } = fakeHost(async () => 'hello')
  const { faux, workspace, dm } = await open(host)
  onTestFinished(() => workspace.dismiss())
  await workspace.familiars.create({ name: 'Ada' })
  const bo = await workspace.familiars.create({ name: 'Bo' })

  let result = ''
  faux.setResponses([
    call('run_command', { command: 'echo hello' }),
    (context: Context) => {
      result = lastResult(context)
      return fauxAssistantMessage('Done.')
    },
  ])
  const room = await dm(bo.id)
  await replyTo(
    room,
    await room.post({ author: owner, text: 'Run it', requestId: 'run' }),
  )
  expect(calls).toEqual([{ familiar: bo.id, tool: 'run_command' }])
  expect(result).toBe('hello')
})

test('an action a restart interrupts is reported, not run again', async () => {
  // Runs until stopped, as a real computer's call does when its host closes.
  const { host, calls } = fakeHost(
    (signal) =>
      new Promise((_, reject) =>
        signal?.addEventListener('abort', () => reject(signal.reason)),
      ),
  )
  const { faux, workspace, dm, storage } = await open(host)
  const ada = await workspace.familiars.create({ name: 'Ada' })
  faux.setResponses([call('run_command', { command: 'make' })])
  const entry = await (
    await dm(ada.id)
  ).post({ author: owner, text: 'Build it', requestId: 'build' })
  await expect.poll(() => calls.length).toBe(1)
  await workspace.dismiss()

  const reopened = await open(host, storage)
  onTestFinished(() => reopened.workspace.dismiss())
  let result = ''
  reopened.faux.setResponses([
    (context: Context) => {
      result = lastResult(context)
      return fauxAssistantMessage('It was interrupted.')
    },
  ])
  await replyTo(await reopened.dm(ada.id), entry)
  expect(calls).toHaveLength(1)
  expect(result).toMatch(/interrupted/i)
})

test("a Familiar's computer in detail is its host's, on the plugin's routes", async () => {
  const { host } = fakeHost(async () => '')
  const { workspace } = await open(host)
  onTestFinished(() => workspace.dismiss())
  const ada = await workspace.familiars.create({ name: 'Ada' })
  const app = createHttpApi(workspace, {
    authenticate: () => owner,
    allow: () => true,
  })
  const response = await app.request(
    `/plugins/computer/familiars/${ada.id}/inspect`,
  )
  expect(await response.json()).toEqual({ doing: [{ tool: `${ada.id}'s` }] })
})

test("saved logins are one per site and username, each Familiar's own, and go when it's removed", async () => {
  const { host } = fakeHost(async () => '')
  const secrets = memorySecrets()
  const { workspace } = await open(host, undefined, secrets)
  onTestFinished(() => workspace.dismiss())
  const ada = await workspace.familiars.create({ name: 'Ada' })
  const bo = await workspace.familiars.create({ name: 'Bo' })
  const app = createHttpApi(workspace, {
    authenticate: () => owner,
    allow: () => true,
  })
  const path = (id: FamiliarId) => `/plugins/computer/familiars/${id}/logins`
  const send = (id: FamiliarId, method: string, body: object) =>
    app.request(path(id), {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  const login = {
    origin: 'https://example.com',
    username: 'ada',
    password: 'first',
  }

  await Promise.all([
    send(ada.id, 'PUT', login),
    send(ada.id, 'PUT', { ...login, password: 'second' }),
    send(ada.id, 'PUT', { ...login, username: 'other' }),
  ])
  expect(await (await app.request(path(ada.id))).json()).toEqual([
    { origin: login.origin, username: 'ada' },
    { origin: login.origin, username: 'other' },
  ])
  expect(await (await app.request(path(bo.id))).json()).toEqual([])
  expect(
    (await send(bo.id, 'PUT', { ...login, origin: 'http://example.com' }))
      .status,
  ).toBe(400)
  expect(
    (await send(ada.id, 'DELETE', { origin: login.origin, username: 'other' }))
      .status,
  ).toBe(204)

  const saved = () =>
    secrets.get(
      { kind: 'plugin', name: 'computer' },
      `familiar/${ada.id}/logins`,
    )
  expect(JSON.parse((await saved())!)).toEqual([
    { ...login, password: 'second' },
  ])
  await workspace.familiars.remove(ada.id)
  expect(await saved()).toBeUndefined()
})

test('a login saved privately in the chat signs in, and its password never reaches storage', async () => {
  const password = 'dummy-private-password'
  const written: string[] = []
  class WatchedStorage extends ReopenableStorage {
    override commit(...args: Parameters<ReopenableStorage['commit']>) {
      written.push(
        JSON.stringify(args[0], (_key, value: unknown) =>
          typeof value === 'bigint' ? String(value) : value,
        ),
      )
      return super.commit(...args)
    }
  }
  const { host } = fakeHost(async () => '')
  const sent: unknown[] = []
  host.call = async (_id, tool, args) => {
    sent.push({ tool, args })
    return { content: [{ type: 'text', text: 'Submitted the login.' }] }
  }
  const { faux, workspace, dm } = await open(host, new WatchedStorage())
  onTestFinished(() => workspace.dismiss())
  await workspace.connections.updateToolSettings(
    { kind: 'plugin', name: 'computer' },
    'sign_in',
    { askBeforeRunning: false },
  )
  const ada = await workspace.familiars.create({ name: 'Ada' })
  const room = await dm(ada.id)
  let runs = 0
  const run = async (name: string, args: JsonObject) => {
    let result = ''
    faux.setResponses([
      call(name, args),
      (context: Context) => {
        result = lastResult(context)
        return fauxAssistantMessage('Done.')
      },
    ])
    const entry = await room.post({
      author: owner,
      text: name,
      requestId: `run-${runs++}`,
    })
    return { entry, result: async () => (await replyTo(room, entry), result) }
  }

  const request = await run('request_login', {
    site: 'https://example.com/login',
  })
  const watch = await room.watchTurns()
  watch.start(async () => {})
  onTestFinished(async () => void (await watch.stop()))
  const asked = () =>
    Object.values(watch.value).flatMap((turn) =>
      'questions' in turn ? (turn.questions ?? []) : [],
    )[0]
  await expect.poll(asked).toMatchObject({ kind: 'private' })
  const question = asked()!
  await workspace.questions.answer(ada.id, question.id, {
    action: 'accept',
    content: { username: 'ada', password },
  })
  expect(await request.result()).toContain('Saved the login for ada')

  const controls = { username: 'e1', password: 'e2', submit: 'e3' }
  const unknown = await run('sign_in', {
    site: 'https://example.com',
    username: 'bo',
    controls,
  })
  expect(await unknown.result()).toContain('No login is saved for bo')
  const signIn = await run('sign_in', {
    site: 'https://example.com',
    username: 'ada',
    controls,
  })
  expect(await signIn.result()).toBe('Submitted the login.')
  expect(sent).toEqual([
    {
      tool: 'browser_sign_in',
      args: {
        origin: 'https://example.com',
        username: 'ada',
        password,
        controls,
      },
    },
  ])
  expect(written.join('')).not.toContain(password)
})
