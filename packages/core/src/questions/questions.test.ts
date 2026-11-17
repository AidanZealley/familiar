import {
  fauxAssistantMessage,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux'
import { expect, test, vi } from 'vitest'
import {
  QuestionError,
  schema,
  type FamiliarPlugin,
  type FormContent,
  type RoomApi,
} from '../index.ts'
import { ReopenableStorage, replyTo, testHost } from '../testing.ts'
import { defineTool, familiar } from '../tools.ts'

// The gate before a connection's tools: what asks, what doesn't, and that
// a question outlives neither its call nor a restart's rerun of it.

const call = (name: string) =>
  fauxAssistantMessage(fauxToolCall(name, { what: 'it' }), {
    stopReason: 'toolUse',
  })

function plugin(ran: string[]): FamiliarPlugin {
  const tool = (name: string, annotations?: object) =>
    defineTool({
      name,
      description: name,
      parameters: schema.obj({ what: schema.str() }),
      ...(annotations && { annotations }),
      execute: async () => {
        ran.push(name)
        return { output: [{ type: 'text' as const, text: `${name} done` }] }
      },
    })
  return {
    name: 'house',
    title: 'House',
    tools: [
      tool('unlock'),
      tool('look', { readOnlyHint: true }),
      tool('light', { destructiveHint: false }),
    ],
  }
}

/** The questions a room's turns show, once there are some. */
async function asked(room: RoomApi) {
  const watch = await room.watchTurns()
  watch.start(async () => {})
  try {
    const questions = () =>
      Object.values(watch.value).flatMap((turn) =>
        'questions' in turn ? (turn.questions ?? []) : [],
      )
    await vi.waitFor(() => expect(questions()).not.toEqual([]))
    return questions()
  } finally {
    await watch.stop()
  }
}

async function setup() {
  const ran: string[] = []
  const notified: string[] = []
  const host = await testHost({
    plugins: [plugin(ran)],
    askFirst: true,
    notify: async ({ title }) => void notified.push(title),
  })
  return { ...host, ran, notified }
}

const resultOf = async (
  host: Awaited<ReturnType<typeof setup>>,
  entry: number,
) => JSON.stringify(await replyTo(host.dm(), entry as never))

test('an unannotated tool waits for approval; approving runs it once', async () => {
  const host = await setup()
  host.faux.setResponses([call('unlock'), fauxAssistantMessage('Unlocked')])
  const entry = await host.dm().post({
    author: { id: 'aidan', name: 'aidan' },
    text: 'Unlock it',
    requestId: 'unlock',
  })
  const [question] = await asked(host.dm())
  expect(question).toMatchObject({
    kind: 'tool',
    tool: 'unlock',
    arguments: { what: 'it' },
  })
  expect(host.ran).toEqual([])
  expect(host.notified).toEqual(['Familiar needs your OK'])

  await host
    .workspace()
    .questions.answer(question!.familiar, question!.id, { action: 'accept' })
  await resultOf(host, entry)
  expect(host.ran).toEqual(['unlock'])
  await expect(
    host
      .workspace()
      .questions.answer(question!.familiar, question!.id, { action: 'accept' }),
  ).rejects.toThrow('no longer waiting')
})

test('declining tells the model; read-only and non-destructive tools never ask', async () => {
  const host = await setup()
  const results: string[] = []
  host.faux.setResponses([
    call('unlock'),
    (context) => {
      results.push(JSON.stringify(context.messages.at(-1)))
      return call('look')
    },
    call('light'),
    fauxAssistantMessage('Done'),
  ])
  const entry = await host.dm().post({
    author: { id: 'aidan', name: 'aidan' },
    text: 'Go',
    requestId: 'go',
  })
  const [question] = await asked(host.dm())
  await host
    .workspace()
    .questions.answer(question!.familiar, question!.id, { action: 'decline' })
  await resultOf(host, entry)
  expect(results[0]).toContain('The person declined this call.')
  expect(host.ran).toEqual(['look', 'light'])
})

test("the owner's policy wins: denied tools never run or ask", async () => {
  const host = await setup()
  const house = { kind: 'plugin' as const, name: 'house' }
  await host.workspace().connections.setPolicy(house, undefined, 'allow')
  await host.workspace().connections.setPolicy(house, 'unlock', 'deny')
  const [info] = await host.workspace().connections.list()
  expect(
    info!.tools.map(({ name, policy, default: fallback }) => [
      name,
      policy,
      fallback,
    ]),
  ).toEqual([
    ['unlock', 'deny', 'allow'],
    ['look', undefined, 'allow'],
    ['light', undefined, 'allow'],
  ])
  const results: string[] = []
  host.faux.setResponses([
    call('unlock'),
    (context) => {
      results.push(JSON.stringify(context.messages.at(-1)))
      return fauxAssistantMessage('Off')
    },
  ])
  await host.say('Unlock it')
  expect(results[0]).toContain('turned unlock off')
  expect(host.ran).toEqual([])
  expect(host.notified).toEqual([])
})

test('a question waiting at a restart is asked again, and runs once when approved', async () => {
  const host = await setup()
  host.faux.setResponses([call('unlock')])
  const entry = await host.dm().post({
    author: { id: 'aidan', name: 'aidan' },
    text: 'Unlock it',
    requestId: 'unlock',
  })
  await asked(host.dm())
  const reopened = await host.reopen({}, async () =>
    host.faux.setResponses([fauxAssistantMessage('Unlocked')]),
  )
  const [question] = await asked(reopened.dm)
  await reopened.workspace.questions.answer(question!.familiar, question!.id, {
    action: 'accept',
  })
  await replyTo(reopened.dm, entry)
  expect(host.ran).toEqual(['unlock'])
})

test('stopping the turn withdraws its question', async () => {
  const host = await setup()
  host.faux.setResponses([call('unlock')])
  await host.dm().post({
    author: { id: 'aidan', name: 'aidan' },
    text: 'Unlock it',
    requestId: 'unlock',
  })
  const [question] = await asked(host.dm())
  await host.dm().stop()
  await vi.waitFor(() =>
    expect(
      host.workspace().questions.answer(question!.familiar, question!.id, {
        action: 'accept',
      }),
    ).rejects.toThrow('no longer waiting'),
  )
  expect(host.ran).toEqual([])
})

test('a new message instead of an answer declines the question, and the Familiar reads it', async () => {
  const host = await setup()
  const seen: string[] = []
  host.faux.setResponses([
    call('unlock'),
    (context) => {
      seen.push(JSON.stringify(context.messages.at(-1)))
      return fauxAssistantMessage('Left it locked.')
    },
    fauxAssistantMessage('Sure, what instead?'),
  ])
  const author = { id: 'aidan', name: 'aidan' }
  const first = await host
    .dm()
    .post({ author, text: 'Unlock it', requestId: 'unlock' })
  await asked(host.dm())
  const second = await host
    .dm()
    .post({ author, text: 'Actually, never mind', requestId: 'never' })
  await resultOf(host, first)
  expect(seen[0]).toContain('sent a new message instead of answering')
  expect(await resultOf(host, second)).toContain('Sure, what instead?')
  expect(host.ran).toEqual([])
})

test("a private question's values reach only its plugin: never storage, the chat's stream or the model", async () => {
  const secret = 'hunter2-never-stored'
  // Everything Familiar ever writes, which includes what clients stream.
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
  const received: FormContent[] = []
  const callers: number[] = []
  const host = await testHost({
    storage: new WatchedStorage(),
    plugins: [
      {
        name: 'logins',
        title: 'Logins',
        tools: [
          defineTool({
            name: 'request_login',
            description: 'Ask for a login',
            parameters: schema.obj({}),
            execute: async (_args, _api, context) => {
              const services = familiar(context)
              callers.push(await services.familiarId())
              const result = await services.askPrivately(
                {
                  message: 'Your login for example.com',
                  form: [
                    { name: 'username', type: 'string', required: true },
                    {
                      name: 'password',
                      type: 'string',
                      format: 'password',
                      required: true,
                    },
                  ],
                },
                async (values) => {
                  if (received.push(values) === 1) {
                    throw new QuestionError('Try again.')
                  }
                },
              )
              return { output: [{ type: 'text' as const, text: result }] }
            },
          }),
        ],
      },
    ],
  })
  const seen: string[] = []
  host.faux.setResponses([
    fauxAssistantMessage(fauxToolCall('request_login', {}), {
      stopReason: 'toolUse',
    }),
    (context) => {
      seen.push(JSON.stringify(context.messages))
      return fauxAssistantMessage('Saved.')
    },
  ])
  const entry = await host.dm().post({
    author: { id: 'aidan', name: 'aidan' },
    text: 'Sign in',
    requestId: 'sign-in',
  })
  // What the chat streams.
  const watch = await host.dm().watchTurns()
  const streamed: string[] = []
  watch.start(async () => void streamed.push(JSON.stringify(watch.value)))
  const [question] = await asked(host.dm())
  expect(question).toMatchObject({ kind: 'private', plugin: 'logins' })

  const answer = (password: string) =>
    host.workspace().questions.answer(question!.familiar, question!.id, {
      action: 'accept',
      content: { username: 'sam', password },
    })
  // The plugin refusing them leaves the person asked.
  await expect(answer(`${secret}-first`)).rejects.toThrow('Try again.')
  await answer(secret)
  const reply = JSON.stringify(await replyTo(host.dm(), entry))
  await watch.stop()

  expect(received.map((values) => values.password)).toEqual([
    `${secret}-first`,
    secret,
  ])
  expect(callers).toEqual([host.familiar().id])
  expect(seen[0]).toContain('provided')
  for (const text of [...written, ...streamed, ...seen, reply]) {
    expect(text).not.toContain(secret)
  }
  expect(written.join('')).toContain('Your login for example.com')
})
