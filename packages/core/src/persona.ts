import {
  defineExtension,
  section,
  type PromptSection,
} from '@earendil-works/pi-durable'
import { familiarIn, Familiars } from './workspace/familiars.ts'

/** Who a Familiar is when it has no persona of its own: its role and tone. */
export const defaultPersona =
  'You’re a personal assistant. Be warm, brief and direct.'

/** The prompt's first line, which tells a Familiar its name. */
const introduction = (name: string) => `You are ${name}.`

/** The name an introduction gives, for a scripted model to answer as. */
export const introducedAs = (text: string) => /^You are (.+)\.$/.exec(text)?.[1]

/** The identity of the Familiar whose conversation a prompt is for. */
const identityOf = async (
  ...[input, context]: Parameters<PromptSection['render']>
) => {
  const state = await input.read.snapshot(Familiars, context)
  const familiar = state && familiarIn(state, input.conversationId)
  return familiar === undefined ? undefined : state!.familiars[familiar]
}

/**
 * The start of every prompt: the name of the Familiar whose conversation it
 * is, its own persona or the default, then what the host says every
 * Familiar should know, such as what its UI renders.
 */
export const createPersona = (hostInstructions: string | undefined) =>
  defineExtension({
    name: 'familiar.persona',
    // Change only when the Familiar's identity or the host's options do: a
    // prompt section that changes resends the prompt and loses the
    // provider's prompt cache.
    sections: [
      section(
        'introduction',
        async (input, context) => {
          const identity = await identityOf(input, context)
          return identity && introduction(identity.name)
        },
        { tag: false },
      ),
      section(
        'persona',
        async (input, context) => {
          const identity = await identityOf(input, context)
          return identity && (identity.persona ?? defaultPersona)
        },
        { tag: false },
      ),
      section('host', () => hostInstructions, { tag: false }),
    ],
  })
