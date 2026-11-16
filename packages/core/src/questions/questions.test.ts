import {
  fauxAssistantMessage,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux'
import { expect, test, vi } from 'vitest'
import { schema, type FamiliarPlugin, type RoomApi } from '../index.ts'
import { replyTo, testHost } from '../testing.ts'
import { defineTool } from '../tools.ts'

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
