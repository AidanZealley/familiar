import { defineExtension, section } from '@earendil-works/pi-durable'

/**
 * Who Familiar is when the host doesn't say: its name, its role and its tone.
 * Hosts that add to it, such as with what their UI renders, start from this.
 */
export const defaultPersona = (name: string) =>
  `You are ${name}, a personal assistant. Be warm, brief and direct.`

/** Who Familiar is: the start of every prompt, exactly as given. */
export const createPersona = (persona: string) =>
  defineExtension({
    name: 'familiar.persona',
    // Fixed for the life of the Familiar: a prompt section that changes
    // resends the prompt and loses the provider's prompt cache.
    sections: [section('preamble', () => persona, { tag: false })],
  })
