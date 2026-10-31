import type {
  AssistantMessage,
  AuthInteraction,
  Credential,
  Models,
} from '@earendil-works/pi-ai'
import { createModels } from '@earendil-works/pi-ai/models'
import {
  fauxAssistantMessage,
  fauxProvider,
} from '@earendil-works/pi-ai/providers/faux'
import { MemoryStorage, type EntryId } from '@earendil-works/pi-durable'
import {
  createAccount,
  summonFamiliar,
  type Account,
  type Familiar,
} from '@familiar/core'
import { createHttpApi } from '@familiar/core/http'
import { afterEach, expect, test, vi } from 'vitest'

// The two ways a host composes Familiar, through the packages' public
// exports only: with an account owners sign in through, or without one when
// the host keeps the credentials working itself.

const opened: Familiar[] = []
afterEach(async () => {
  await Promise.all(opened.splice(0).map((familiar) => familiar.dismiss()))
})

const model = { provider: 'faux', modelId: 'faux-1' }

async function host(account?: (models: Models) => Promise<Account>) {
  const faux = fauxProvider({ models: [{ id: 'faux-1' }] })
  const models = createModels()
  models.setProvider(faux.provider)
  const familiar = await summonFamiliar({
    storage: new MemoryStorage(),
    models,
    model,
    timeZone: 'UTC',
    account: await account?.(models),
  })
  opened.push(familiar)
  const api = createHttpApi(familiar, { authenticate: () => 'aidan' })
  return { faux, models, familiar, api }
}

/** The event stream's first `account` event, parsed. */
async function firstAccountEvent(api: ReturnType<typeof createHttpApi>) {
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
  const { faux, models, familiar, api } = await host()

  expect(familiar.account).toBeUndefined()
  expect((await api.request('/account')).status).toBe(404)
  expect(
    (await api.request('/account/sign-in', { method: 'POST' })).status,
  ).toBe(404)
  for (const body of ['{}', '{', '{"text":"hello"}']) {
    expect(
      (
        await api.request('/account/sign-in/answer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        })
      ).status,
    ).toBe(404)
  }
  expect(await firstAccountEvent(api)).toBeNull()

  faux.setResponses([fauxAssistantMessage('Hello.')])
  await familiar.send({ author: 'aidan', text: 'Hi', requestId: 'hi' })
  await familiar.idle()

  // A credential the host let lapse fails the request like any other error.
  vi.spyOn(models, 'getAuth').mockRejectedValue(new Error('token revoked'))
  await familiar.send({ author: 'aidan', text: 'Again', requestId: 'again' })
  await familiar.idle()

  const page = await familiar.history(Number.MAX_SAFE_INTEGER as EntryId, 50)
  const replies = page.entries
    .filter((entry) => entry.kind === 'pi.assistant')
    .map((entry) => (entry.model?.[0] as AssistantMessage).stopReason)
  expect(replies).toEqual(['error', 'stop'])
})

test('an attached account signs in on the Models requests use, and dismissal stops it without signing out', async () => {
  let interaction: AuthInteraction | undefined
  const { models, familiar, api } = await host((models) =>
    createAccount({ models, provider: 'faux' }),
  )
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
