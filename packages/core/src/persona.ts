import { defineExtension, section } from '@earendil-works/pi-durable'
import { Familiars, familiarIn } from './workspace/familiars.ts'

/**
 * Who Familiar is when the host doesn't say: its name, its role and its tone.
 * Hosts that add to it, such as with what their UI renders, start from this.
 */
export const defaultPersona = (name: string) =>
  `You are ${name}, a personal assistant. Be warm, brief and direct.`

/**
 * Who Familiar is: the start of every prompt. The host's `persona` exactly
 * as given, or else the default for the Familiar the conversation belongs to.
 */
export const createPersona = (persona: string | undefined) =>
  defineExtension({
    name: 'familiar.persona',
    // Changes only with the Familiar's name: a prompt section that changes
    // resends the prompt and loses the provider's prompt cache.
    sections: [
      section(
        'preamble',
        async (input, context) => {
          if (persona !== undefined) {
            return persona
          }
          const familiars = await input.read.snapshot(Familiars, context)
          const familiar =
            familiars && familiarIn(familiars, input.conversationId)
          return familiar === undefined
            ? undefined
            : defaultPersona(familiars!.familiars[familiar].name)
        },
        { tag: false },
      ),
    ],
  })
