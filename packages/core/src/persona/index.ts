import { defineExtension, section } from '@earendil-works/pi-durable'

// Kept stable: a prompt section that changes resends the prompt and loses the
// provider's prompt cache.
const preamble = (name: string) =>
  `You are ${name}, a personal assistant. You live in one long-running conversation with the people you help, so earlier messages may be days old. Be warm, brief and direct. Each person's messages are their own words; reply to the latest one.`

/** Who Familiar is: the start of every prompt. */
export const createPersona = (name: string) =>
  defineExtension({
    name: 'familiar.persona',
    sections: [section('preamble', () => preamble(name), { tag: false })],
  })
