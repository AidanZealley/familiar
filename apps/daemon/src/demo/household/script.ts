import type { AssistantMessage, ToolCall } from '@familiar-ai/core/models'
import {
  fauxAssistantMessage,
  fauxText,
  fauxThinking,
  fauxToolCall,
} from '@familiar-ai/core/models/faux'
import type { ScriptedRequest } from '@familiar-ai/core/models/scripted'
import { textOf } from '../scenarios/scenario.ts'

/**
 * How the household's Familiars answer what the seed says to them: each
 * reply is written down next to the message it answers (see story.ts), and
 * the scripted model looks it up by who is asked and what.
 */

/** A tool call's arguments. */
type Args = ToolCall['arguments']

/** One model response in a reply: thinking, then text, then tool calls. */
export type Step = {
  think?: string
  text?: string
  tools?: { name: string; args: Args }[]
  /** The response fails with this, after `text`. */
  error?: string
  /** With `error`: the reply when the person tries the failed one again. */
  retried?: Reply
  /**
   * A reply this step leads to: to a schedule it makes, by the same
   * Familiar, each time it falls due, or to a handoff, by the one it asks.
   */
  causes?: { familiar?: string; input: string; reply: Reply }
}

/** A Familiar's whole reply to one input: its model responses, in order. */
export type Reply = Step[]

export const say = (text: string, think?: string): Step => ({
  text,
  ...(think && { think }),
})

export const use = (name: string, args: Args = {}, think?: string): Step => ({
  tools: [{ name, args }],
  ...(think && { think }),
})

/** Finds an MCP tool with tool_search, then calls it: their tools are deferred. */
export const mcp = (server: string, tool: string, args: Args = {}): Step[] => [
  use('tool_search', { query: tool.replaceAll('_', ' ') }),
  use(`mcp__${server}__${tool}`, args),
]

/** Says nothing this turn, as a Familiar does when it wasn't addressed directly. */
export const quiet = (reason: string): Reply => [use('stay_quiet', { reason })]

/** Asks `to` to take a turn with `note`, which it answers with `answer`. */
export const handOff = (
  to: string,
  note: string,
  answer: Reply,
  then: string,
): Reply => [
  {
    ...use('hand_off', { to, note }),
    causes: { familiar: to, input: note, reply: answer },
  },
  say(then),
]

/** Schedules `prompt`, answered with `reply` each time it falls due. */
export const schedule = (
  prompt: string,
  when: { at: string } | { repeat: string },
  reply: Reply,
): Step => ({
  ...use('schedule', { prompt, ...when }),
  causes: { input: prompt, reply },
})

/**
 * A reply that fails partway, with an error the model's provider doesn't
 * retry, answered with `retried` when the person tries it again.
 */
export const fail = (
  partial: string,
  error: string,
  retried?: Reply,
): Reply => [{ text: partial, error, ...(retried && { retried }) }]

/** Who answers, and which input: a person's message, a handoff's note or a due schedule's prompt. */
type Key = { familiar: string; input: string }

const keyOf = ({ familiar, input }: Key) => `${familiar}\n${input}`

/**
 * The household's replies, and how the scripted model finds the one it's
 * asked for. Each Familiar is recognised by its persona, which starts its
 * system prompt; a tool call's ID says which reply and step it came from.
 */
export function createScript(familiars: { name: string; persona: string }[]) {
  const replies: Reply[] = []
  const byKey = new Map<string, number>()
  // A failed reply's retry, by its key, and the keys that have failed.
  const retries = new Map<string, number>()
  const failed = new Set<string>()

  const add = (key: Key, reply: Reply) => {
    byKey.set(keyOf(key), replies.push(reply) - 1)
    for (const { causes, retried } of reply) {
      if (causes) {
        add(
          { familiar: causes.familiar ?? key.familiar, input: causes.input },
          causes.reply,
        )
      }
      if (retried) {
        retries.set(keyOf(key), replies.push(retried) - 1)
      }
    }
  }

  const respond = (index: number, at: number): AssistantMessage => {
    const step = replies[index][at]
    const tools = (step.tools ?? []).map(({ name, args }, call) =>
      fauxToolCall(name, args, { id: `script-${index}-${at}-${call}` }),
    )
    return fauxAssistantMessage(
      [
        ...(step.think ? [fauxThinking(step.think)] : []),
        ...(step.text ? [fauxText(step.text)] : []),
        ...tools,
      ],
      step.error
        ? { stopReason: 'error', errorMessage: step.error }
        : { stopReason: tools.length ? 'toolUse' : 'stop' },
    )
  }

  /** The reply's next step, or undefined for a request it doesn't script. */
  const reply = (request: ScriptedRequest) => {
    const { context } = request
    if (request.type === 'tool-result') {
      // Notes such as recall's can follow the results.
      const last = context.messages.findLast(
        (message) => message.role === 'toolResult',
      )
      const id = last?.toolCallId ?? ''
      const [, index, at] = /^script-(\d+)-(\d+)-/.exec(id) ?? []
      const next = Number(at) + 1
      return index !== undefined && replies[Number(index)][next]
        ? respond(Number(index), next)
        : undefined
    }
    const prompt = context.messages
      .flatMap((message) =>
        message.role === 'system'
          ? [textOf(message.content), ...Object.values(message.sections ?? {})]
          : [],
      )
      .join('\n')
    const familiar = familiars.find(({ persona }) =>
      prompt.includes(persona),
    )?.name
    const input = inputOf(request)
    if (familiar === undefined || input === undefined) {
      return undefined
    }
    const key = keyOf({ familiar, input })
    const index = (failed.has(key) && retries.get(key)) || byKey.get(key)
    if (index === undefined) {
      return undefined
    }
    if (replies[index].some((step) => step.error)) {
      failed.add(key)
    }
    return respond(index, 0)
  }

  return { add, reply }
}

export type Script = ReturnType<typeof createScript>

/** What a request answers: a message's text, a handoff's note or a schedule's prompt. */
function inputOf(request: ScriptedRequest) {
  switch (request.type) {
    case 'message':
      return request.text
    case 'handoff':
      return request.note
    case 'scheduled': {
      // `[Scheduled for …] prompt`, the last part of its input; notes such
      // as recall's can follow it.
      const due = request.context.messages
        .flatMap((message) =>
          message.role === 'user' && Array.isArray(message.content)
            ? [textOf(message.content.slice(-1))]
            : [],
        )
        .findLast((text) => text.startsWith('[Scheduled for '))
      return due?.slice(due.indexOf('] ') + 2)
    }
  }
}
