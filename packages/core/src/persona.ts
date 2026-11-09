import { defineExtension, section } from '@earendil-works/pi-durable'
import { familiarIn, Familiars } from './workspace/familiars.ts'

/**
 * Who a Familiar is when it has no persona of its own: its name, its role
 * and its tone.
 */
export const defaultPersona = (name: string) =>
  `You are ${name}, a personal assistant. Be warm, brief and direct.`

/**
 * The start of every prompt: who the Familiar whose conversation it is is,
 * its own persona or the default for its name, then what the host says
 * every Familiar should know, such as what its UI renders.
 */
export const createPersona = (hostInstructions: string | undefined) =>
  defineExtension({
    name: 'familiar.persona',
    // Change only when the Familiar's identity or the host's options do: a
    // prompt section that changes resends the prompt and loses the
    // provider's prompt cache.
    sections: [
      section(
        'preamble',
        async (input, context) => {
          const state = await input.read.snapshot(Familiars, context)
          const familiar = state && familiarIn(state, input.conversationId)
          if (familiar === undefined) {
            return undefined
          }
          const { name, persona } = state!.familiars[familiar]
          return persona ?? defaultPersona(name)
        },
        { tag: false },
      ),
      section('host', () => hostInstructions, { tag: false }),
    ],
  })
