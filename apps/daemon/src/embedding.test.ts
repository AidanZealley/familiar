import type { AuthInteraction, Credential } from '@familiar-ai/core/models'
import { createModels } from '@familiar-ai/core/models'
import { fauxProvider } from '@familiar-ai/core/models/faux'
import { MemoryStorage } from '@earendil-works/pi-durable'
import {
  summonFamiliar,
  type AccountOptions,
  type Familiar,
} from '@familiar-ai/core'
import { createHttpApi, type HttpApi } from '@familiar-ai/core/http'
import { afterEach, expect, test, vi } from 'vitest'

// The two ways a host composes Familiar, through the packages' public
// exports only: with an account owners sign in through, or without one when
// the host keeps the credentials working itself.

const opened: Familiar[] = []
afterEach(async () => {
  await Promise.all(opened.splice(0).map((familiar) => familiar.dismiss()))
})

const model = { provider: 'faux', modelId: 'faux-1' }

async function host(account?: AccountOptions) {
  const faux = fauxProvider({ models: [{ id: 'faux-1' }] })
  const models = createModels()
  models.setProvider(faux.provider)
  const familiar = await summonFamiliar({
    storage: new MemoryStorage(),
    models,
    model,
    timeZone: 'UTC',
    account,
  })
  opened.push(familiar)
  const api = createHttpApi(familiar, {
    allow: () => true,
    authenticate: () => ({ id: 'aidan', name: 'aidan' }),
  })
  return { models, familiar, api }
}

/** The event stream's first `account` event, parsed. */
async function firstAccountEvent(api: HttpApi) {
  const response = await api.request('/events')
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader()
  const event = /^event: account\ndata: (.+)$/m
  let text = ''
  while (!event.test(text)) {
    text += (await reader.read()).value
  }
  await reader.cancel()
  return JSON.parse(text.match(event)![1]!) as unknown
}

test('a host that manages credentials gets chat without account routes', async () => {
  const { familiar, api } = await host()

  expect(familiar.account).toBeUndefined()
  expect((await api.request('/account')).status).toBe(404)
  expect(
    (await api.request('/account/sign-in', { method: 'POST' })).status,
  ).toBe(404)
  expect(await firstAccountEvent(api)).toBeNull()
})

test('an attached account signs in on the Models requests use, and dismissal stops it without signing out', async () => {
  let interaction: AuthInteraction | undefined
  const { models, familiar, api } = await host({})
  const login = vi
    .spyOn(models, 'login')
    .mockImplementation((_provider, _type, next) => {
      interaction = next
      next.notify({ type: 'auth_url', url: 'https://example.com/authorize' })
      return new Promise<Credential>((_resolve, reject) =>
        next.signal?.addEventListener('abort', () =>
          reject(new Error('aborted')),
        ),
      )
    })
  const logout = vi.spyOn(models, 'logout')

  expect(await firstAccountEvent(api)).toEqual({ status: 'signed-in' })
  expect(
    (await api.request('/account/sign-in', { method: 'POST' })).status,
  ).toBe(202)
  expect(login).toHaveBeenCalledWith(
    'faux',
    'oauth',
    expect.anything(),
    undefined,
  )
  expect(await (await api.request('/account')).json()).toEqual({
    status: 'signing-in',
    url: 'https://example.com/authorize',
  })

  await familiar.dismiss()
  expect(interaction?.signal?.aborted).toBe(true)
  expect(logout).not.toHaveBeenCalled()
  expect(familiar.account?.state()).toEqual({
    status: 'signing-in',
    url: 'https://example.com/authorize',
  })
})
