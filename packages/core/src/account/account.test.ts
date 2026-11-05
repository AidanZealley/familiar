import type {
  AuthInteraction,
  Credential,
  LoginOptions,
  Models,
} from '@earendil-works/pi-ai'
import { createModels } from '@earendil-works/pi-ai/models'
import {
  fauxAssistantMessage,
  fauxProvider,
} from '@earendil-works/pi-ai/providers/faux'
import { MemoryStorage } from '@earendil-works/pi-durable'
import { expect, test, vi } from 'vitest'
import { createHttpApi } from '../http/index.ts'
import { summonFamiliar, type Familiar } from '../index.ts'
import { testHost } from '../testing.ts'
import { createAccount, type AccountState } from './index.ts'

const credential = { type: 'oauth' } as unknown as Credential

/**
 * A browser login like ChatGPT's: it shows a page whose last step returns to
 * this machine, and also takes that address pasted, whichever comes first.
 */
function fakeModels() {
  let stored = false
  let loginOptions: LoginOptions | undefined
  let received: string | undefined
  let returned: ((address: string) => void) | undefined
  let fail: ((error: Error) => void) | undefined

  const models = {
    checkAuth: async () => (stored ? { type: 'oauth' as const } : undefined),
    getAuth: vi.fn(async () => (stored ? { auth: {} } : undefined)),
    login: async (
      _provider: string,
      _type: string,
      next: AuthInteraction,
      options?: LoginOptions,
    ) => {
      loginOptions = options
      next.notify({ type: 'auth_url', url: 'https://example.com/authorize' })
      const stopAsking = new AbortController()
      const callback = new Promise<string>((resolve, reject) => {
        returned = resolve
        fail = reject
        next.signal?.addEventListener('abort', () =>
          reject(new Error('aborted')),
        )
      })
      // A prompt that stops asking leaves the callback to finish the login.
      const paste = next
        .prompt({
          type: 'manual_code',
          message: 'Paste the address',
          signal: stopAsking.signal,
        })
        .catch(() => new Promise<string>(() => {}))
      try {
        received = await Promise.race([callback, paste])
      } finally {
        stopAsking.abort()
      }
      stored = true
      return credential
    },
  } as unknown as Models

  return {
    models,
    loginOptions: () => loginOptions,
    received: () => received,
    returnToThisMachine: () => returned!('http://localhost:1455/?code=x'),
    deny: () => fail!(new Error('Access denied.')),
  }
}

/** Each state the account moves through. */
const record = (api: { onChange(l: (s: AccountState) => void): unknown }) => {
  const states: AccountState[] = []
  api.onChange((state) => states.push(state))
  return states
}

const settled = () => new Promise((resolve) => setTimeout(resolve))

const signingIn = (paste?: boolean): AccountState => ({
  status: 'signing-in',
  url: 'https://example.com/authorize',
  ...(paste === undefined ? {} : { paste }),
})

test('a browser sign-in takes the address it ended on, pasted from another device', async () => {
  const fake = fakeModels()
  // OpenAI refuses to sign in an installation that doesn't say which it is.
  const login = { getDeviceId: () => 'device-1', agentName: 'Familiar' }
  const { api } = await createAccount(fake.models, 'p', { login })
  const states = record(api)

  api.signIn()
  api.signIn() // a second press joins the running sign-in
  await settled()
  api.answer('http://localhost:1455/?code=abc')
  await settled()

  expect(states).toEqual([
    { status: 'signing-in' },
    signingIn(),
    signingIn(true),
    signingIn(false),
    { status: 'signed-in' },
  ])
  expect(fake.received()).toBe('http://localhost:1455/?code=abc')
  expect(fake.loginOptions()).toBe(login)
})

test('a browser sign-in finished on this machine stops asking for the address', async () => {
  const fake = fakeModels()
  const { api } = await createAccount(fake.models, 'p', {})

  api.signIn()
  await settled()
  fake.returnToThisMachine()
  api.answer('too late')
  await settled()

  expect(api.state()).toEqual({ status: 'signed-in' })
  expect(fake.received()).toBe('http://localhost:1455/?code=x')
})

test('a failed sign-in says why; a cancelled one says nothing', async () => {
  const fake = fakeModels()
  const { api } = await createAccount(fake.models, 'p', {})

  api.signIn()
  await settled()
  fake.deny()
  await settled()
  expect(api.state()).toEqual({
    status: 'signed-out',
    error: 'Access denied.',
  })

  api.signIn()
  await settled()
  api.cancelSignIn()
  await settled()
  expect(api.state()).toEqual({ status: 'signed-out' })
})

/** Real Models over the faux provider, as a host would build them. */
function fauxModels() {
  const faux = fauxProvider({ models: [{ id: 'faux-1' }] })
  const models = createModels()
  models.setProvider(faux.provider)
  return { faux, models }
}

const model = { provider: 'faux', modelId: 'faux-1' }

test('a reply failing on a login that stopped working marks it expired, and a working one recovers', async () => {
  const { faux, models } = fauxModels()
  const familiar = await summonFamiliar({
    storage: new MemoryStorage(),
    models,
    model,
    timeZone: 'UTC',
    account: {},
  })
  const say = async (text: string) => {
    await familiar.send({
      author: { id: 'aidan', name: 'aidan' },
      text,
      requestId: text,
    })
    await familiar.idle()
    await settled()
  }

  try {
    expect(familiar.account?.state()).toEqual({ status: 'signed-in' })

    // As when the provider refuses to refresh the token: every request fails.
    const getAuth = vi
      .spyOn(models, 'getAuth')
      .mockRejectedValue(new Error('refresh refused'))
    await say('hello')
    expect(familiar.account?.state()).toEqual({ status: 'expired' })

    getAuth.mockRestore()
    faux.setResponses([fauxAssistantMessage('Hi!')])
    await say('hello again')
    expect(familiar.account?.state()).toEqual({ status: 'signed-in' })
  } finally {
    await familiar.dismiss()
  }
})

test('without an account a host gets no account routes; with one, dismissal stops a sign-in without signing out', async () => {
  const api = (familiar: Familiar) =>
    createHttpApi(familiar, {
      allow: () => true,
      authenticate: () => ({ id: 'aidan', name: 'aidan' }),
    })
  /** The event stream's first `account` event, parsed. */
  const firstAccountEvent = async (familiar: Familiar) => {
    const response = await api(familiar).request('/events')
    const reader = response
      .body!.pipeThrough(new TextDecoderStream())
      .getReader()
    const event = /^event: account\ndata: (.+)$/m
    let text = ''
    while (!event.test(text)) {
      text += (await reader.read()).value
    }
    await reader.cancel()
    return JSON.parse(text.match(event)![1]!) as unknown
  }

  // A host that keeps its credentials working itself.
  const unattached = (await testHost()).familiar()
  expect(unattached.account).toBeUndefined()
  expect((await api(unattached).request('/account')).status).toBe(404)
  expect(await firstAccountEvent(unattached)).toBeNull()

  // A host owners sign in through.
  const host = await testHost({ account: {} })
  const familiar = host.familiar()
  let interaction: AuthInteraction | undefined
  vi.spyOn(host.models, 'login').mockImplementation(
    (_provider, _type, next) => {
      interaction = next
      next.notify({ type: 'auth_url', url: 'https://example.com/authorize' })
      return new Promise<Credential>((_resolve, reject) =>
        next.signal?.addEventListener('abort', () =>
          reject(new Error('aborted')),
        ),
      )
    },
  )
  const logout = vi.spyOn(host.models, 'logout')
  expect(
    (await api(familiar).request('/account/sign-in', { method: 'POST' }))
      .status,
  ).toBe(202)
  await vi.waitFor(() =>
    expect(familiar.account?.state()).toEqual({
      status: 'signing-in',
      url: 'https://example.com/authorize',
    }),
  )
  await host.dismiss()
  expect(interaction?.signal?.aborted).toBe(true)
  expect(logout).not.toHaveBeenCalled()
})
