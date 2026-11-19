import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context'
import * as schema from '@earendil-works/pi-schema'
import {
  fauxAssistantMessage,
  fauxToolCall,
  type FauxResponseStep,
} from '@earendil-works/pi-ai/providers/faux'
import {
  createRegistry,
  defineExtension,
  defineTask,
  defineTool,
  GenerationTask,
  Harness,
  hook,
  LiveDoc,
  runEndTask,
  type ConversationId,
  type EntryId,
  type HarnessOptions,
  type SubmissionId,
} from '@earendil-works/pi-durable'
import { expect, onTestFinished, test } from 'vitest'
import { MESSAGE_KIND } from '../conversation/message.ts'
import { fauxModels, ReopenableStorage } from '../testing.ts'

/**
 * What rooms rely on Pi doing (see rooms/turn.ts and rooms/answer.ts): with
 * only follow-ups, one at a time, each run holds one input, so its answer
 * has one room; and a run-end task's keyed room write lands once across a
 * crash and rerun. Run these first after upgrading Pi.
 */

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const answer = fauxAssistantMessage
const call = (name: string) =>
  answer(fauxToolCall(name, {}), { stopReason: 'toolUse' })

const draft = (content: string, room: ConversationId) => ({
  type: 'input' as const,
  content,
  requestId: content,
  entry: { kind: MESSAGE_KIND, data: { room, text: content } },
})

async function openChat(
  responses: FauxResponseStep[],
  settings?: HarnessOptions['settings'],
  extension: Parameters<typeof defineExtension>[0] = { name: 'probe' },
) {
  const { faux, models } = fauxModels()
  faux.setResponses(responses)
  const registry = createRegistry()
  registry.install(defineExtension(extension))
  const storage = new ReopenableStorage()
  const open = async () => {
    const harness = await Harness.open(
      storage,
      { models, registry, settings },
      context,
    )
    onTestFinished(() => harness.close(context))
    harness.resume()
    return harness
  }
  const harness = await open()
  const chat = await harness.createConversation(
    {
      ownership: { kind: 'ownerless' },
      agent: { model: { provider: 'faux', modelId: 'faux-1' } },
    },
    context,
  )
  const room = () =>
    harness.createConversation({ ownership: { kind: 'ownerless' } }, context)
  const a = await room()
  const b = await room()
  return {
    harness,
    open,
    chat,
    a: a.id,
    b: b.id,
    storage,
    send: (input: ReturnType<typeof draft>) => chat.submit(input, context),
    live: () => harness.snapshot(LiveDoc, chat.id, context),
  }
}

function toolRound(name: string, terminate = false) {
  const entered = deferred<void>()
  const release = deferred<void>()
  onTestFinished(() => release.resolve())
  const tool = defineTool({
    name,
    description: name,
    parameters: schema.obj({}),
    execute: async () => {
      entered.resolve()
      await release.promise
      return {
        output: [{ type: 'text', text: name }],
        ...(terminate && { control: { terminate: true } }),
      }
    },
  })
  return { tool, entered: entered.promise, release: release.resolve }
}

test('one-at-a-time follow-ups keep every run in one room, including after terminate', async () => {
  const quiet = toolRound('stay_quiet', true)
  const { send, a, b } = await openChat(
    [
      call('stay_quiet'),
      answer('B'),
      answer('A again'),
      answer('B again'),
      answer('fallback answer'),
    ],
    { followUpMode: 'one-at-a-time' },
    { name: 'probe', tools: [quiet.tool] },
  )
  const original = await send(draft('A initial', a))
  await quiet.entered
  const next = [
    await send(draft('B follow-up', b)),
    await send(draft('A follow-up', a)),
    await send(draft('B second follow-up', b)),
  ]
  quiet.release()
  const receipts = await Promise.all(
    [original, ...next].map((input) => input.wait(context)),
  )
  const answers = receipts.map((receipt) => {
    if (receipt.type !== 'input' || receipt.status !== 'done') {
      throw new Error('Missing answer')
    }
    return receipt.answer
  })
  expect(new Set(answers).size).toBe(4)
  expect(answers).toEqual(answers.toSorted((left, right) => left - right))
  const fallback = await send(draft('idle fallback', a))
  expect(await fallback.wait(context)).toMatchObject({
    type: 'input',
    status: 'done',
  })
})

test('a run-end task posts one room entry when interrupted after posting and rerun', async () => {
  const firstPost = deferred<void>()
  const posts: SubmissionId[] = []
  let hooks = 0
  const terminal = () => ({
    status: 'terminal' as const,
    outcome: { status: 'completed' as const, result: null },
  })
  const postReply = defineTask<
    { room: ConversationId; answer: EntryId },
    { phase: 'post' },
    null
  >({
    name: 'probe.post-reply',
    version: 1,
    initial: () => ({ phase: 'post' }),
    phases: {
      post: async (task, runtime, context) => {
        const { room, answer } = task.input
        const log = (await runtime.conversation(room, context))!
        const receipt = await log.submit(
          {
            type: 'write',
            requestId: `reply:${answer}`,
            entry: { kind: 'probe.reply', data: { answer } },
          },
          context,
        )
        posts.push(receipt.id)
        if (posts.length === 1) {
          firstPost.resolve()
          // Close the host after the write is durable, before this task records completion.
          await new Promise<void>((resolve) => {
            if (context.abortSignal?.aborted) {
              resolve()
            } else {
              context.abortSignal?.addEventListener('abort', () => resolve(), {
                once: true,
              })
            }
          })
          return
        }
        await runtime.commit(terminal, context)
      },
    },
    abort: (_task, runtime, context) =>
      runtime.commit(
        () => ({ status: 'terminal', outcome: { status: 'aborted' } }),
        context,
      ),
  })
  const { harness, open, chat, live, send, a, storage } = await openChat(
    [answer('A answer')],
    undefined,
    {
      name: 'probe',
      tasks: [postReply],
      hooks: [
        hook(GenerationTask, {
          afterRun: (run) => {
            hooks++
            return {
              tasks: [runEndTask(postReply, { room: a, answer: run.answer })],
            }
          },
        }),
      ],
    },
  )
  const input = await send(draft('A initial', a))
  const receipt = await input.wait(context)
  await firstPost.promise
  expect(receipt).toMatchObject({ status: 'done' })
  const held = (await live())?.run
  expect(held?.inputs).toEqual([])
  expect(held?.afterRun?.tasks).toHaveLength(1)
  const firstInput = await harness.commit(
    (tx) => tx.entry(held!.first!),
    context,
  )
  expect(firstInput?.data).toMatchObject({ room: a })
  const firstEntry = await storage.submission(posts[0], context)
  expect(firstEntry).toMatchObject({ type: 'write', status: 'done' })

  await harness.close(context)
  const reopened = await open()
  const reopenedChat = (await reopened.conversation(chat.id, context))!
  await reopenedChat.waitForIdle(context)
  const room = (await reopened.conversation(a, context))!
  const entries = (await room.entries({}, 20, undefined, context)).items
  expect(posts).toEqual([posts[0], posts[0]])
  expect(hooks).toBe(1)
  expect(entries).toHaveLength(1)
  expect(firstEntry).toMatchObject({ entry: entries[0].id })
  expect(
    await reopened.waitForTask(held!.afterRun!.tasks![0], context),
  ).toMatchObject({ state: { outcome: { status: 'completed' } } })
})
