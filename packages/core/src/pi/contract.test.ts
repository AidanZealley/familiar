import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { Type } from '@earendil-works/pi-ai'
import {
  fauxAssistantMessage,
  fauxToolCall,
  type FauxResponseStep,
} from '@earendil-works/pi-ai/providers/faux'
import {
  createRegistry,
  defineDoc,
  defineExtension,
  defineTask,
  defineTool,
  Harness,
  ReadAfterWrite,
  ROOT_CONVERSATION_ID,
  type HarnessOptions,
  type Task,
} from '@earendil-works/pi-durable'
import { expect, test } from 'vitest'
import { fakeClock, fauxModels, ReopenableStorage } from '../testing.ts'

/**
 * What Familiar relies on Pi doing beyond what its types say: Pi is
 * experimental and changes without notice. After upgrading Pi, typecheck
 * finds changed APIs; these tests find changed behaviour, so run them first.
 * Each says what depends on it.
 */

const context = BACKGROUND_CONTEXT

type Items = { items: string[] }
const common = {
  kind: 'test.items',
  version: 1,
  scope: 'session',
  initial: () => ({ items: [] }),
  checkpointWhen: () => true,
} as const
const Singleton = defineDoc<Items>(common)

const harnessOptions = (
  tasks: Task<never, never, never, never>[] = [],
  clock?: ReturnType<typeof fakeClock>,
): HarnessOptions => {
  const registry = createRegistry()
  registry.install(defineExtension({ name: 'test', tasks }))
  return {
    models: fauxModels().models,
    registry,
    now: clock?.now,
    setTimer: clock?.setTimer,
  }
}

// Finding a task by status: resuming a schedule (schedules/task.ts).
test('a commit finds a task by conversation, kind and status while it sleeps and once it ends', async () => {
  const clock = fakeClock(1_000)
  const sleeper = defineTask<null, { phase: 'wait' } | { phase: 'run' }, null>({
    name: 'test.sleeper',
    version: 1,
    initial: () => ({ phase: 'wait' }),
    phases: {
      wait: (_task, runtime, context) =>
        runtime.sleepUntil(5_000, { phase: 'run' }, context),
      run: (_task, runtime, context) =>
        runtime.commit(
          () => ({
            status: 'terminal',
            outcome: { status: 'completed', result: null },
          }),
          context,
        ),
    },
    abort: (_task, runtime, context) =>
      runtime.commit(
        () => ({ status: 'terminal', outcome: { status: 'aborted' } }),
        context,
      ),
  })

  const harness = await Harness.open(
    new ReopenableStorage(),
    harnessOptions([sleeper as never], clock),
    context,
  )
  await harness.root(context)
  const id = await harness.commit(
    (tx) =>
      tx.createTask(sleeper, null, {
        ownership: { kind: 'conversation' },
        conversationId: ROOT_CONVERSATION_ID,
        background: true,
      }),
    context,
  )
  harness.resume()
  const found = (status: 'sleeping' | 'terminal') =>
    harness.commit(
      async (tx) =>
        (
          await tx.scanTasks(
            {
              conversationId: ROOT_CONVERSATION_ID,
              kind: 'test.sleeper',
              status,
            },
            10,
          )
        ).items.map((task) => task.id),
      context,
    )
  await expect.poll(() => found('sleeping')).toEqual([id])

  clock.advanceTo(5_000)
  await harness.waitForTask(id, context)
  expect(await found('sleeping')).toEqual([])
  expect(await found('terminal')).toEqual([id])
  await harness.close(context)
})

/**
 * A harness with one chat conversation on the faux model, which answers with
 * `responses` in turn; a step that returns a promise holds that request open.
 */
async function openChat(responses: FauxResponseStep[]) {
  const echo = defineTool({
    name: 'echo',
    description: 'Echoes',
    parameters: Type.Object({}),
    execute: async () => ({ output: [{ type: 'text', text: 'echoed' }] }),
  })
  const hush = defineTool({
    name: 'hush',
    description: 'Ends the run',
    parameters: Type.Object({}),
    execute: async () => ({
      output: [{ type: 'text', text: 'hushed' }],
      control: { terminate: true },
    }),
  })
  const registry = createRegistry()
  registry.install(defineExtension({ name: 'test', tools: [echo, hush] }))
  const { faux, models } = fauxModels()
  faux.setResponses(responses)
  const harness = await Harness.open(
    new ReopenableStorage(),
    // The setting Familiar runs with (see harness.ts).
    { models, registry, settings: { afterFailedRun: 'continue' } },
    context,
  )
  harness.resume()
  const chat = await harness.createConversation(
    {
      ownership: { kind: 'ownerless' },
      agent: { model: { provider: 'faux', modelId: 'faux-1' } },
    },
    context,
  )
  return {
    harness,
    chat,
    send: (text: string) =>
      chat.submit(
        {
          type: 'input',
          content: text,
          requestId: text,
          entry: { kind: 'test.message', data: { text } },
        },
        context,
      ),
    /** The inbox, the running run and the transcript, as Pi shows them. */
    view: async () => {
      const { value } = await chat.viewState(context)
      return {
        queued: (
          value.docs['pi.inbox'] as { items: { id: number }[] }
        ).items.map((item) => item.id),
        run: (value.docs['pi.live'] as { run?: { taskId: number } }).run,
        entries: value.entries,
      }
    },
  }
}

// Posting to a room (rooms/log.ts).
test('a room post is one commit: a write submission, its entry and the task it causes, and a retry repeats none of it', async () => {
  const ran: string[] = []
  const turn = defineTask<{ id: string }, { phase: 'run' }, null>({
    name: 'test.turn',
    version: 1,
    initial: () => ({ phase: 'run' }),
    phases: {
      run: async (task, runtime, context) => {
        ran.push(task.input.id)
        await runtime.commit(
          () => ({
            status: 'terminal',
            outcome: { status: 'completed', result: null },
          }),
          context,
        )
      },
    },
    abort: (_task, runtime, context) =>
      runtime.commit(
        () => ({ status: 'terminal', outcome: { status: 'aborted' } }),
        context,
      ),
  })
  const harness = await Harness.open(
    new ReopenableStorage(),
    harnessOptions([turn as never]),
    context,
  )
  harness.resume()
  const room = await harness.createConversation(
    { ownership: { kind: 'ownerless' } },
    context,
  )

  const post = (requestId: string) =>
    harness.commit(async (tx) => {
      const posted = await tx.submissionByRequest(room.id, requestId)
      if (posted) {
        return
      }
      const submission = await tx.createSubmission({
        type: 'write',
        conversationId: room.id,
        requestId,
        status: 'queued',
      })
      // No `model`, so the entry is display-only and Pi never queues it.
      const entry = await tx.appendEntry(room.id, {
        kind: 'test.message',
        data: { text: requestId },
      })
      tx.placeSubmission(submission.id, entry.id)
      // Background, so it never makes the room look busy.
      await tx.createTask(
        turn,
        { id: requestId },
        {
          ownership: { kind: 'conversation' },
          conversationId: room.id,
          background: true,
        },
      )
    }, context)

  await post('m1')
  await post('m1')

  const entries = (await room.viewState(context)).value.entries
  expect(entries.map((entry) => entry.data)).toEqual([{ text: 'm1' }])
  expect(
    await harness.commit(
      (tx) => tx.submissionByRequest(room.id, 'm1'),
      context,
    ),
  ).toMatchObject({ type: 'write', status: 'done', entry: entries[0].id })
  await expect.poll(() => ran).toEqual(['m1'])
  await harness.close(context)
})

// Stopping a room's turn (rooms/turn.ts).
test('stopping a run settles only its input; the inputs queued behind it wait until a write that changes the model context starts them', async () => {
  const { harness, chat, send, view } = await openChat([
    // A's request hangs until the run is aborted.
    (_context, options) =>
      new Promise((_resolve, reject) =>
        options?.signal?.addEventListener('abort', () => reject(new Error())),
      ),
    fauxAssistantMessage('B done'),
  ])
  const a = await send('A')
  await expect.poll(async () => (await view()).run).toBeDefined()
  const [b, c] = [await send('B'), await send('C')]
  const statuses = async () =>
    (await Promise.all([a, b, c].map((input) => input.status(context)))).map(
      (input) => input.status,
    )
  expect(await statuses()).toEqual(['placed', 'queued', 'queued'])

  // Withdrawing one queued input leaves the run and the other inputs alone.
  expect(await c.abort(context)).toBe('aborted')
  expect(await statuses()).toEqual(['placed', 'queued', 'unanswered'])

  // Aborting the run's task settles its input and nothing else. (The
  // conversation's own `abort()` would also withdraw B.)
  const { run } = await view()
  expect(await harness.abortTask(run!.taskId as never, context)).toBe('marked')
  await expect.poll(async () => (await view()).run).toBeUndefined()
  expect(await statuses()).toEqual(['unanswered', 'queued', 'unanswered'])

  // Surprising: `afterFailedRun: 'continue'` covers failed runs, not aborted
  // ones, so B stays queued with nothing running until something else
  // arrives. A write that changes the model context (even an empty `model`)
  // sends the inbox through a boundary and starts it.
  await new Promise((resolve) => setTimeout(resolve, 200))
  expect((await view()).queued).toEqual([b.id])
  await chat.submit(
    { type: 'write', entry: { kind: 'test.wake', model: [] } },
    context,
  )
  await expect.poll(statuses).toEqual(['unanswered', 'done', 'unanswered'])
  await harness.close(context)
})

// Copying a turn's run into its room as a reply (rooms/turn.ts).
test("a run's assistant and tool-result entries are the ones from its input to its answer, when later inputs follow up rather than steer", async () => {
  let release!: () => void
  const { harness, send, view } = await openChat([
    // The model calls a tool once the second input is queued.
    () =>
      new Promise((resolve) => {
        release = () =>
          resolve(
            fauxAssistantMessage(fauxToolCall('echo', {}), {
              stopReason: 'toolUse',
            }),
          )
      }),
    fauxAssistantMessage('A done'),
    fauxAssistantMessage('B done'),
  ])
  const a = await send('A')
  await expect.poll(async () => (await view()).run).toBeDefined()
  const b = await send('B')
  await expect.poll(() => release).toBeDefined()
  release()

  const [doneA, doneB] = await Promise.all([a.wait(context), b.wait(context)])
  if (
    doneA.type !== 'input' ||
    doneA.status !== 'done' ||
    doneB.type !== 'input' ||
    doneB.status !== 'done'
  ) {
    throw new Error('Both inputs should have been answered.')
  }
  const { entries } = await view()
  // Other kinds can sit in the range, such as the `pi.system` Pi writes when a
  // run starts, so select by kind. `answer` is the last of the run's entries.
  const between = (from: number, to: number) =>
    entries
      .filter((entry) => entry.id > from && entry.id <= to)
      .map((entry) => entry.kind)
      .filter((kind) => kind === 'pi.assistant' || kind === 'pi.tool-result')

  expect(between(doneA.entry, doneA.answer)).toEqual([
    'pi.assistant',
    'pi.tool-result',
    'pi.assistant',
  ])
  // B waited for A to finish. A steered input would be placed inside A's
  // run, between its tool result and its answer, and share A's answer.
  expect(doneB.entry).toBeGreaterThan(doneA.answer)
  expect(between(doneB.entry, doneB.answer)).toEqual(['pi.assistant'])
  await harness.close(context)
})

// Staying quiet in a room turn (rooms/tools.ts, rooms/turn.ts).
test("a tool result that asks to terminate ends the run without another request; the input's answer is the call, and the result follows it", async () => {
  let requests = 0
  const { harness, send, view } = await openChat([
    () => {
      requests++
      return fauxAssistantMessage(fauxToolCall('hush', {}), {
        stopReason: 'toolUse',
      })
    },
    () => {
      requests++
      return fauxAssistantMessage('never')
    },
  ])
  const settled = await (await send('A')).wait(context)
  if (settled.type !== 'input' || settled.status !== 'done') {
    throw new Error('The input should have been answered.')
  }
  const { entries } = await view()
  // Surprising: the answer is the assistant entry that made the call, and
  // the tool's result comes after it, so a run's messages run past its answer
  // up to the next input.
  const after = entries.filter((entry) => entry.id >= settled.answer)
  expect(after.map((entry) => entry.model?.[0])).toMatchObject([
    {
      role: 'assistant',
      stopReason: 'toolUse',
      content: [{ type: 'toolCall', name: 'hush' }],
    },
    { role: 'toolResult', toolName: 'hush' },
  ])
  expect(requests).toBe(1)
  await harness.close(context)
})

// Open rooms chain their turns (rooms/turn.ts).
test('a task can wait on tasks it does not own, finished or not, and resumes once each is terminal however it ended', async () => {
  const ran: string[] = []
  const releases = new Map<string, () => void>()
  type Step = { phase: 'wait' } | { phase: 'hold' } | { phase: 'run' }
  const step = defineTask<
    { id: string; after?: number; hold?: boolean },
    Step,
    null
  >({
    name: 'test.step',
    version: 1,
    initial: (input) =>
      input.after !== undefined ? { phase: 'wait' } : { phase: 'hold' },
    phases: {
      wait: (task, runtime, context) =>
        runtime.commit(
          () => ({
            status: 'waiting',
            checkpoint: { phase: 'hold' },
            on: [task.input.after as never],
            policy: 'allSettled',
          }),
          context,
        ),
      hold: async (task, runtime, context) => {
        if (task.input.hold) {
          await new Promise<void>((resolve) =>
            releases.set(task.input.id, resolve),
          )
        }
        await runtime.commit(
          () => ({ status: 'running', checkpoint: { phase: 'run' } }),
          context,
        )
      },
      run: async (task, runtime, context) => {
        ran.push(task.input.id)
        await runtime.commit(
          () => ({
            status: 'terminal',
            outcome: { status: 'completed', result: null },
          }),
          context,
        )
      },
    },
    abort: (_task, runtime, context) =>
      runtime.commit(
        () => ({ status: 'terminal', outcome: { status: 'aborted' } }),
        context,
      ),
  })
  const harness = await Harness.open(
    new ReopenableStorage(),
    harnessOptions([step as never]),
    context,
  )
  harness.resume()
  const room = await harness.createConversation(
    { ownership: { kind: 'ownerless' } },
    context,
  )
  const create = (id: string, after?: number, hold?: boolean) =>
    harness.commit(
      (tx) =>
        tx.createTask(
          step,
          { id, after, hold },
          {
            ownership: { kind: 'conversation' },
            conversationId: room.id,
            background: true,
          },
        ),
      context,
    )

  // b waits for a, which is held; c waits for b.
  const a = await create('a', undefined, true)
  const b = await create('b', a)
  await create('c', b)
  await expect.poll(() => releases.has('a')).toBe(true)
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(ran).toEqual([])
  releases.get('a')!()
  await expect.poll(() => ran).toEqual(['a', 'b', 'c'])

  // On a task that's already terminal, it carries on at once.
  await create('d', a)
  await expect.poll(() => ran).toEqual(['a', 'b', 'c', 'd'])

  // An aborted task settles a wait too.
  const e = await create('e', undefined, true)
  await create('f', e)
  await expect.poll(() => releases.has('e')).toBe(true)
  const aborted = harness.abortTask(e, context)
  releases.get('e')!()
  await aborted
  await expect.poll(() => ran).toEqual(['a', 'b', 'c', 'd', 'f'])
  await harness.close(context)
})

// Rooms: a room's stream sends its turns as a document of their own, as
// views leave it out, and a marker starts a long room's view (rooms/log.ts).
test("a conversation's view shows only Pi's own documents, and an entry's head starts it", async () => {
  const harness = await Harness.open(
    new ReopenableStorage(),
    harnessOptions(),
    context,
  )
  const Notes = defineDoc<Items>({
    ...common,
    kind: 'test.notes',
    scope: 'conversation',
    history: 'latest',
    fork: 'initial',
  })
  const log = await harness.createConversation(
    { ownership: { kind: 'ownerless' } },
    context,
  )
  const ids = await harness.commit(async (tx) => {
    ;(await tx.doc(Notes, log.id)).items.push('kept apart')
    const appended = []
    for (const text of ['one', 'two', 'three']) {
      appended.push(
        (await tx.appendEntry(log.id, { kind: 'test.entry', data: text })).id,
      )
    }
    await tx.appendEntry(log.id, { kind: 'test.marker', head: appended[1] })
    return appended
  }, context)

  const watch = await log.watch(context)
  await watch.stop()
  expect(watch.value.docs['test.notes']).toBeUndefined()
  const [marker, ...shown] = watch.value.entries
  expect(marker.kind).toBe('test.marker')
  expect(shown.map((entry) => entry.id)).toEqual(ids.slice(1))
  await harness.close(context)
})

// Everywhere a commit reads entries, tasks or submissions: they come first
// (rooms/log.ts, schedules/task.ts).
test('a commit reads tables before writing any, though documents may follow writes', async () => {
  const harness = await Harness.open(
    new ReopenableStorage(),
    harnessOptions(),
    context,
  )
  await expect(
    harness.commit(async (tx) => {
      const created = await tx.createConversation({
        ownership: { kind: 'ownerless' },
      })
      await tx.scanEntries({ conversationId: created.id }, 1)
    }, context),
  ).rejects.toBeInstanceOf(ReadAfterWrite)

  await harness.commit(async (tx) => {
    await tx.createConversation({ ownership: { kind: 'ownerless' } })
    ;(await tx.doc(Singleton)).items.push('after a write')
  }, context)
  expect(await harness.snapshot(Singleton, context)).toEqual({
    items: ['after a write'],
  })
  await harness.close(context)
})

// Which plugins and MCP connections a Familiar uses (workspace/capabilities.ts),
// and tool search coming with any MCP server's extension (mcp/connection.ts).
test("a conversation's removed extensions stay off while ones installed later reach it, and a tool several extensions provide is offered once", async () => {
  const tool = (name: string) =>
    defineTool({
      name,
      description: name,
      parameters: Type.Object({}),
      execute: async () => ({ output: [] }),
    })
  const a = defineExtension({ name: 'a', tools: [tool('a'), tool('shared')] })
  const b = defineExtension({ name: 'b', tools: [tool('b'), tool('shared')] })
  const registry = createRegistry()
  registry.install(a)
  registry.install(b)
  const harness = await Harness.open(
    new ReopenableStorage(),
    { models: fauxModels().models, registry },
    context,
  )
  const root = await harness.root(context)
  const offered = async () =>
    (await root.agent(context)).tools.map(({ name }) => name).sort()

  expect(await offered()).toEqual(['a', 'b', 'shared'])
  await root.configure({ extensions: { remove: [a] } }, context)
  expect(await offered()).toEqual(['b', 'shared'])
  registry.install(
    defineExtension({ name: 'c', tools: [tool('c'), tool('shared')] }),
  )
  expect(await offered()).toEqual(['b', 'c', 'shared'])
  await root.configure(
    { extensions: { remove: [a, b, { name: 'c' }] } },
    context,
  )
  expect(await offered()).toEqual([])
  await harness.close(context)
})
