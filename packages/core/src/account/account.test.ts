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
import { Harness, MemoryStorage } from '@earendil-works/pi-durable'
import { expect, test, vi } from 'vitest'
import { summonFamiliar } from '../familiar.ts'
import { createAccount, type Account, type AccountState } from './index.ts'

const credential = { type: 'oauth' } as unknown as Credential

/**
 * A provider login that pauses at each step until the test moves it on.
 * `ignoreAbort` finishes it only when the test says, as a provider that has
 * already sent its token might.
 */
function fakeModels(signedIn = false, { ignoreAbort = false } = {}) {
  let stored = signedIn
  let interaction: AuthInteraction | undefined
  let loginOptions: LoginOptions | undefined
  let finish: ((value: Credential) => void) | undefined
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
      interaction = next
      loginOptions = options
      const method = await next.prompt({
        type: 'select',
        message: 'How?',
        options: [
          { id: 'browser', label: 'Browser' },
          { id: 'device_code', label: 'Device code' },
        ],
      })
      expect(method).toBe('device_code')
      if (!ignoreAbort) {
        next.signal?.addEventListener('abort', () =>
          fail?.(new Error('aborted')),
        )
      }
      return new Promise<Credential>((resolve, reject) => {
        finish = (value) => {
          stored = true
          resolve(value)
        }
        fail = reject
      })
    },
    logout: vi.fn(async () => {
      stored = false
    }),
  } as unknown as Models

  return {
    models,
    stored: () => stored,
    loginOptions: () => loginOptions,
    showCode: () =>
      interaction!.notify({
        type: 'device_code',
        userCode: 'ABCD-1234',
        verificationUri: 'https://example.com/device',
      }),
    approve: () => finish!(credential),
    deny: () => fail!(new Error('The code expired.')),
  }
}

/** Each state the account moves through. */
const record = (api: { onChange(l: (s: AccountState) => void): unknown }) => {
  const states: AccountState[] = []
  api.onChange((state) => states.push(state))
  return states
}

const settled = () => new Promise((resolve) => setTimeout(resolve))

test('starts as whatever login is stored', async () => {
  const out = await createAccount({
    models: fakeModels().models,
    provider: 'p',
  })
  const into = await createAccount({
    models: fakeModels(true).models,
    provider: 'p',
  })
  expect(out.api.state()).toEqual({ status: 'signed-out' })
  expect(into.api.state()).toEqual({ status: 'signed-in' })
})

test('signs in with a device code and applies the login at once', async () => {
  const fake = fakeModels()
  // OpenAI refuses to sign in an installation that doesn't say which it is.
  const login = { getDeviceId: () => 'device-1', agentName: 'Familiar' }
  const { api } = await createAccount({
    models: fake.models,
    provider: 'p',
    login,
  })
  const states = record(api)

  api.signIn()
  api.signIn() // a second press joins the running sign-in
  await settled()
  fake.showCode()
  fake.approve()
  await settled()

  expect(states).toEqual([
    { status: 'signing-in' },
    {
      status: 'signing-in',
      url: 'https://example.com/device',
      code: 'ABCD-1234',
    },
    { status: 'signed-in' },
  ])
  expect(fake.loginOptions()).toBe(login)
})

/**
 * A browser login like ChatGPT's: it shows a page whose last step returns to
 * this machine, and also takes that address pasted, whichever comes first.
 */
function browserModels() {
  let returned: ((address: string) => void) | undefined
  let pasted: string | undefined
  const models = {
    checkAuth: async () => undefined,
    login: async (_provider: string, _type: string, next: AuthInteraction) => {
      next.notify({ type: 'auth_url', url: 'https://example.com/authorize' })
      const stopAsking = new AbortController()
      const address = await Promise.race([
        new Promise<string>((resolve) => (returned = resolve)),
        next.prompt({
          type: 'manual_code',
          message: 'Paste the address',
          signal: stopAsking.signal,
        }),
      ])
      stopAsking.abort()
      pasted = address
      return credential
    },
  } as unknown as Models
  return {
    models,
    returnToThisMachine: () => returned!('http://localhost:1455/?code=x'),
    received: () => pasted,
  }
}

test('a browser sign-in takes the address it ended on, pasted from another device', async () => {
  const fake = browserModels()
  const { api } = await createAccount({ models: fake.models, provider: 'p' })
  const states = record(api)

  api.signIn()
  await settled()
  api.answer('http://localhost:1455/?code=abc')
  await settled()

  expect(states).toEqual([
    { status: 'signing-in' },
    { status: 'signing-in', url: 'https://example.com/authorize' },
    { status: 'signing-in', url: 'https://example.com/authorize', paste: true },
    {
      status: 'signing-in',
      url: 'https://example.com/authorize',
      paste: false,
    },
    { status: 'signed-in' },
  ])
  expect(fake.received()).toBe('http://localhost:1455/?code=abc')
})

test('a browser sign-in finished on this machine stops asking for the address', async () => {
  const fake = browserModels()
  const { api } = await createAccount({ models: fake.models, provider: 'p' })

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
  const { api } = await createAccount({ models: fake.models, provider: 'p' })

  api.signIn()
  await settled()
  fake.deny()
  await settled()
  expect(api.state()).toEqual({
    status: 'signed-out',
    error: 'The code expired.',
  })

  api.signIn()
  await settled()
  api.cancelSignIn()
  await settled()
  expect(api.state()).toEqual({ status: 'signed-out' })
})

test('signing out forgets the login', async () => {
  const { api } = await createAccount({
    models: fakeModels(true).models,
    provider: 'p',
  })
  await api.signOut()
  expect(api.state()).toEqual({ status: 'signed-out' })
})

test('closing stops an unfinished sign-in but keeps the stored login', async () => {
  const fake = fakeModels(true)
  const account = await createAccount({ models: fake.models, provider: 'p' })
  const states = record(account.api)

  account.api.signIn()
  await settled()
  fake.showCode()
  account.close()
  await settled()

  expect(states).toEqual([
    { status: 'signing-in' },
    {
      status: 'signing-in',
      url: 'https://example.com/device',
      code: 'ABCD-1234',
    },
  ])
  expect(fake.models.logout).not.toHaveBeenCalled()
  expect(fake.stored()).toBe(true)

  // A closed account starts nothing new.
  account.api.signIn()
  await account.api.signOut()
  await settled()
  expect(fake.models.logout).not.toHaveBeenCalled()
  expect(fake.stored()).toBe(true)
  expect(states).toHaveLength(2)
})

test('a sign-in finishing after close changes nothing', async () => {
  const fake = fakeModels(false, { ignoreAbort: true })
  const account = await createAccount({ models: fake.models, provider: 'p' })
  const states = record(account.api)

  account.api.signIn()
  await settled()
  account.close()
  fake.approve()
  await settled()

  expect(states).toEqual([{ status: 'signing-in' }])
  expect(account.api.state()).toEqual({ status: 'signing-in' })
  // The provider's login still reached the host's Models.
  expect(fake.stored()).toBe(true)
})

/** Real Models over the faux provider, as a host would build them. */
function fauxModels() {
  const faux = fauxProvider({ models: [{ id: 'faux-1' }] })
  const models = createModels()
  models.setProvider(faux.provider)
  return { faux, models }
}

const model = { provider: 'faux', modelId: 'faux-1' }

test('a Familiar refuses an account for other Models or another provider', async () => {
  const { models } = fauxModels()
  const elsewhere = await createAccount({
    models: fauxModels().models,
    provider: 'faux',
  })
  const otherProvider = await createAccount({ models, provider: 'openai' })
  const open = (account: Account) =>
    summonFamiliar({
      storage: new MemoryStorage(),
      models,
      model,
      timeZone: 'UTC',
      account,
    })

  await expect(open(elsewhere)).rejects.toThrow('the same Models')
  await expect(open(otherProvider)).rejects.toThrow(
    'account is for openai, but the model is from faux.',
  )
})

test('an account has one Familiar owner and cannot attach after dismissal', async () => {
  const { models } = fauxModels()
  const account = await createAccount({ models, provider: 'faux' })
  const open = () =>
    summonFamiliar({
      storage: new MemoryStorage(),
      models,
      model,
      timeZone: 'UTC',
      account,
    })
  const familiar = await open()
  try {
    await expect(open()).rejects.toThrow('account is already attached')
  } finally {
    await familiar.dismiss()
  }
  await expect(open()).rejects.toThrow('account is already closed')
})

test('failed startup leaves the account available for retry', async () => {
  const { models } = fauxModels()
  const account = await createAccount({ models, provider: 'faux' })
  const storage = new MemoryStorage()
  vi.spyOn(Harness, 'open').mockRejectedValueOnce(
    new Error('storage unavailable'),
  )
  await expect(
    summonFamiliar({ storage, models, model, timeZone: 'UTC', account }),
  ).rejects.toThrow('storage unavailable')
  const familiar = await summonFamiliar({
    storage: new MemoryStorage(),
    models,
    model,
    timeZone: 'UTC',
    account,
  })
  await familiar.dismiss()
})

test('a reply failing on a login that stopped working marks it expired, and a working one recovers', async () => {
  const { faux, models } = fauxModels()
  const account = await createAccount({ models, provider: 'faux' })
  const familiar = await summonFamiliar({
    storage: new MemoryStorage(),
    models,
    model,
    timeZone: 'UTC',
    account,
  })
  const say = async (text: string) => {
    await familiar.send({ author: 'aidan', text, requestId: text })
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
