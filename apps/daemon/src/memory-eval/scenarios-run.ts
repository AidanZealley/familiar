import { MemoryStorage } from '@earendil-works/pi-durable'
import type {
  Message,
  Provider,
  TranscriptContext,
} from '@earendil-works/pi-ai'
import {
  definePlugin,
  defineTool,
  Type,
  type Author,
  type RoomApi,
  type RoomId,
} from '@familiar-ai/core'
import {
  nextNight,
  RECALL_HEADING,
  textOf,
} from '@familiar-ai/core/diagnostics'
import { replyTo } from '../reply.ts'
import { openDaemonWorkspace } from '../workspace.ts'
import { createClock, EVAL_TIME_ZONE, noonOf } from './clock.ts'
import {
  createMeter,
  type EvalAccess,
  type Meter,
  type TokenTotals,
} from './model.ts'
import { grade, type Probe, type Scenario } from './scenarios.ts'
import { replyText, settle, within } from './settle.ts'
import { waitForClock } from './unfiled.ts'

const DAY = 24 * 60 * 60 * 1000
/** Small, as the unfiled eval's is, so what was said leaves the model's view and only memory can bring it back. */
const CONTEXT_BUDGET = 4_000
const REPLY_TIMEOUT = 5 * 60 * 1000
/** Day 0 of every scenario. */
const START = '2026-03-02'

/** What the model was shown for one probe, as text. */
export type Shown = {
  reply: string
  /** The memory section of the prompt. */
  section: string
  /** The recall note shown with the message, and what recall tool calls returned. */
  recalled: string
}

export type ProbeResult = {
  who: string
  room: string
  text: string
  shown: Shown
  failures: string[]
}

export type ScenarioResult = {
  id: string
  passed: boolean
  probes: ProbeResult[]
  tokens: TokenTotals
}

/** Records every request the chat model is sent, whoever answers it. */
function tap(model: string) {
  const requests: TranscriptContext[] = []
  const wrap = (provider: Provider): Provider => ({
    ...provider,
    stream: (m, context, options) => {
      if (m.id === model) {
        requests.push(context)
      }
      return provider.stream(m, context, options)
    },
    streamSimple: (m, context, options) => {
      if (m.id === model) {
        requests.push(context)
      }
      return provider.streamSimple(m, context, options)
    },
  })
  return { requests, wrap }
}

/** The memory section of the prompt, as the latest system message that sets it gives it. */
const sectionOf = (messages: Message[]) =>
  messages.reduce(
    (section, message) =>
      message.role === 'system' && message.sections?.memory
        ? message.sections.memory
        : section,
    '',
  )

/**
 * What memory put in front of the model: automatic recall's note after the
 * message, whole, and the notes among the `recall` tool's results. A search
 * the model chose also finds past conversations, which are the record, not
 * something memory kept, so only its notes count.
 */
const recalledIn = (requests: readonly TranscriptContext[]) => {
  const notes = new Set<string>()
  for (const { messages } of requests) {
    for (const message of messages) {
      if (
        message.role === 'user' &&
        textOf(message).startsWith(RECALL_HEADING)
      ) {
        notes.add(textOf(message))
      }
      if (message.role === 'toolResult' && message.toolName === 'recall') {
        for (const line of textOf(message).split('\n')) {
          if (/^n\d+, /.test(line)) {
            notes.add(line)
          }
        }
      }
    }
  }
  return [...notes].join('\n\n')
}

const authorOf = (name: string): Author => ({ id: name.toLowerCase(), name })

/**
 * Plays `scenario` in a real workspace on `access`'s models: each message in
 * its room at its day's noon, memory filing and writing profiles each night
 * in between, then
 * each probe asked at its day, graded on its reply, the memory section its
 * request carried and what recall showed.
 */
export async function runScenario(
  scenario: Scenario,
  access: EvalAccess,
  root: Meter,
  progress: (message: string) => void = () => {},
): Promise<ScenarioResult> {
  const meter = createMeter(Infinity, { parent: root })
  const clock = createClock(noonOf(START))
  const storage = new MemoryStorage()
  const models = access.models(meter)
  const chat = tap(access.reply.model.modelId)
  const provider = access.reply.model.provider
  models.setProvider(chat.wrap(models.getProvider(provider)!))

  const plugin = definePlugin({
    name: 'scenario',
    title: 'Scenario',
    tools: [
      defineTool({
        name: 'read_page',
        description: 'Reads a web page and returns its text.',
        parameters: Type.Object({ url: Type.String() }),
        execute: async () => ({
          output: [{ type: 'text', text: scenario.page ?? 'Page not found.' }],
        }),
      }),
    ],
  })
  const sameModel = access.memory.model.modelId === access.reply.model.modelId
  const { workspace, familiar } = await openDaemonWorkspace(
    {
      storage,
      models,
      chatModel: access.reply.model,
      modelChoices: sameModel ? [access.reply] : [access.reply, access.memory],
      memoryModel: access.memory.model,
      timeZone: EVAL_TIME_ZONE,
      contextBudget: CONTEXT_BUDGET,
      now: clock.now,
      setTimer: clock.setTimer,
      plugins: scenario.page ? [plugin] : [],
      ...(scenario.page && { defaultCapabilities: { plugins: ['scenario'] } }),
    },
    'Familiar',
  )

  const rooms = new Map<string, RoomApi>()
  const roomFor = async (who: string, name?: string) => {
    const key = name ?? `dm:${who}`
    let room = rooms.get(key)
    if (!room) {
      const id: RoomId = name
        ? await workspace.rooms.create({
            name,
            familiars: [familiar],
            lead: familiar,
          })
        : await workspace.rooms.dm(familiar, authorOf(who).id)
      room = (await workspace.rooms.get(id))!
      rooms.set(key, room)
    }
    return room
  }

  const results: ProbeResult[] = []
  let sent = 0
  /** Posts a message and waits for the reply, running the clock through any retry. */
  const post = async (event: { who: string; room?: string; text: string }) => {
    const room = await roomFor(event.who, event.room)
    const entry = await room.post({
      author: authorOf(event.who),
      text: event.text,
      requestId: `${scenario.id}:${sent++}`,
    })
    await settle(
      workspace,
      clock,
      meter,
      // Short of memory's night, so a day's messages are filed then.
      nextNight(clock.now(), EVAL_TIME_ZONE),
    )
    return within(
      REPLY_TIMEOUT,
      `${scenario.id} got no reply in time.`,
      replyTo(room, entry),
      meter,
    )
  }

  try {
    await waitForClock(storage, clock, nextNight(clock.now(), EVAL_TIME_ZONE))
    const events = [
      ...scenario.say.map((event) => ({ event, probe: undefined })),
      ...scenario.probes.map((event) => ({
        event: event as Probe,
        probe: event as Probe,
      })),
    ].sort((a, b) => a.event.day - b.event.day)

    let day = -1
    for (const { event, probe } of events) {
      if (event.day !== day) {
        if (day >= 0) {
          // The night between: memory files what is left and writes profiles.
          const night = nextNight(clock.now(), EVAL_TIME_ZONE)
          clock.advanceTo(night)
          await settle(workspace, clock, meter, night + DAY / 2)
        }
        day = event.day
        clock.advanceTo(Math.max(clock.now(), noonOf(START) + day * DAY))
      }
      chat.requests.length = 0
      const answer = await post(event)
      meter.check()
      if (!probe) {
        continue
      }
      const first = chat.requests[0]
      const shown: Shown = {
        reply: answer.outcome === 'answered' ? replyText(answer.messages) : '',
        section: first ? sectionOf(first.messages) : '',
        recalled: recalledIn(chat.requests),
      }
      const failures = [
        ...grade('reply', probe.reply, shown.reply),
        ...grade('memory section', probe.section, shown.section),
        ...grade('recall', probe.recalled, shown.recalled),
      ]
      results.push({
        who: probe.who,
        room: probe.room ?? 'DM',
        text: probe.text,
        shown,
        failures,
      })
      progress(
        `${scenario.id} (${probe.who}, ${probe.room ?? 'DM'}): ${failures.length ? `FAIL ${failures.join('; ')}` : 'pass'}`,
      )
    }
  } finally {
    await workspace.dismiss()
  }
  return {
    id: scenario.id,
    passed: results.every((result) => !result.failures.length),
    probes: results,
    tokens: meter.totals(),
  }
}
