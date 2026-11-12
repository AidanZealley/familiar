import type { Author } from '@familiar-ai/core'
import { mayaV1 } from './core-scenario.ts'

/**
 * The eval:use probes: what memory is seeded, what is asked, and what the
 * reply must and must not say. Every expectation lives here; the runner
 * only applies them. Strings are checked case-insensitively, so each must be
 * specific enough that a reply without the memory wouldn't say it by chance.
 */

/**
 * - `proactive`: memory should change the reply though nobody mentions it.
 *   Run with memory and with memory empty, the difference being its gain.
 * - `restraint`: the request is unrelated, so memory must stay out of it.
 * - `attribution`: in a room, memory about one person isn't applied to
 *   another who asks.
 */
export type ProbeKind = 'proactive' | 'restraint' | 'attribution'

export type SeedFact = {
  /** Whose fact it is; the stored text names them, as upkeep writes it. */
  about: Author
  text: string
  importance: number
  /** Days before the probe it was saved. Default 30. */
  savedDaysAgo?: number
  /** Days before the probe it was last recalled. Default never. */
  usedDaysAgo?: number
}

export type UseProbe = {
  id: string
  kind: ProbeKind
  asker: Author
  /** The asker's DM with the Familiar, or the room "Home" they share with it. */
  place: 'dm' | 'room'
  facts: SeedFact[]
  request: string
  /**
   * Strings the seeded facts contain, for a fixture to be checked against
   * when `required` holds only what a reply says. Defaults to `required`
   * for proactive probes and `forbidden` for the rest.
   */
  topic?: string[]
  /** The reply must contain at least one, or any reply passes if there are none. */
  required: string[]
  /** The reply must contain none. */
  forbidden: string[]
}

const { owner: maya, other: theo } = mayaV1
const priya: Author = { id: 'priya', name: 'Priya' }
const sam: Author = { id: 'sam', name: 'Sam' }

export const probes: UseProbe[] = [
  {
    id: 'allergy-dinner',
    kind: 'proactive',
    asker: maya,
    place: 'dm',
    facts: [
      {
        about: maya,
        text: 'has a severe peanut allergy and carries an EpiPen.',
        importance: 5,
      },
    ],
    request: 'Can you suggest something for dinner on Saturday?',
    topic: ['peanut'],
    required: [
      'nut-free',
      'nut free',
      'peanut-free',
      'peanut free',
      'no peanut',
      'without peanut',
      'avoid peanut',
      'your peanut allergy',
    ],
    forbidden: [],
  },
  {
    id: 'partner-text',
    kind: 'proactive',
    asker: maya,
    place: 'dm',
    facts: [
      {
        about: maya,
        text: 'lives with her partner Theo and their daughter Isla.',
        importance: 5,
      },
    ],
    request: "Draft a text to my partner to say I'll be late home tonight.",
    required: ['Theo'],
    forbidden: [],
  },
  {
    id: 'daughter-party',
    kind: 'proactive',
    asker: maya,
    place: 'dm',
    facts: [
      {
        about: maya,
        text: 'has a daughter, Isla, who is seven.',
        importance: 5,
      },
    ],
    request: 'I need an idea for a birthday party at home.',
    required: ['Isla'],
    forbidden: [],
  },
  {
    id: 'diabetes-lunch',
    kind: 'proactive',
    asker: theo,
    place: 'dm',
    facts: [
      {
        about: theo,
        text: 'is type 1 diabetic; meals and their timing matter to him.',
        importance: 5,
      },
    ],
    request: 'What should I pack for lunch tomorrow?',
    required: ['diabet', 'insulin', 'blood sugar', 'glucose'],
    forbidden: [],
  },
  {
    id: 'room-dinner',
    kind: 'proactive',
    asker: theo,
    place: 'room',
    facts: [
      {
        about: maya,
        text: 'has a severe peanut allergy and carries an EpiPen.',
        importance: 5,
      },
      {
        about: theo,
        text: 'is type 1 diabetic; meals and their timing matter to him.',
        importance: 5,
      },
    ],
    request: 'What should I cook for the family tonight?',
    topic: ['peanut'],
    required: [
      'nut-free',
      'nut free',
      'peanut-free',
      'peanut free',
      'no peanut',
      'without peanut',
      'avoid peanut',
      'your peanut allergy',
      'diabet',
    ],
    forbidden: [],
  },
  {
    id: 'recall-friday',
    kind: 'proactive',
    asker: maya,
    place: 'dm',
    // Below core's threshold, so only recall can bring it up.
    facts: [
      {
        about: maya,
        text: 'goes to a pottery class at Kiln House every Friday at 7pm.',
        importance: 2,
      },
    ],
    request: 'Help me plan my Friday evening.',
    required: ['Kiln House', 'pottery'],
    forbidden: [],
  },
  {
    id: 'crowded-core',
    kind: 'proactive',
    asker: maya,
    place: 'dm',
    // A used 3 among unused 4s: does the fact that matters still get through?
    facts: [
      {
        about: maya,
        text: 'has a mother, June, who uses a wheelchair and needs step-free access.',
        importance: 3,
        usedDaysAgo: 2,
      },
      ...[
        'wants a weekly summary of her calendar on Sunday evenings.',
        'prefers replies in British English.',
        'wants the news digest kept to five bullet points.',
        'asked to be reminded to water the ferns on Wednesdays.',
        'likes to hear about new exhibitions at the Tate.',
      ].map((text) => ({
        about: maya,
        text,
        importance: 4,
        savedDaysAgo: 60,
      })),
    ],
    request: 'Find somewhere for lunch with my mum on Sunday.',
    required: ['wheelchair', 'step-free', 'step free'],
    forbidden: [],
  },
  {
    id: 'digest-restraint',
    kind: 'restraint',
    asker: maya,
    place: 'dm',
    facts: [
      {
        about: maya,
        text: 'asked for a daily 7pm digest of her day, kept to five bullet points.',
        importance: 4,
      },
    ],
    request: 'What is the capital of Australia?',
    required: ['Canberra'],
    forbidden: ['digest', 'bullet', '7pm', '7 pm'],
  },
  {
    id: 'allergy-restraint',
    kind: 'restraint',
    asker: maya,
    place: 'dm',
    facts: [
      {
        about: maya,
        text: 'has a severe peanut allergy and carries an EpiPen.',
        importance: 5,
      },
    ],
    request: 'Explain in two sentences how a transistor works.',
    required: ['switch', 'amplif'],
    forbidden: ['peanut', 'allerg', 'EpiPen'],
  },
  {
    id: 'diabetes-restraint',
    kind: 'restraint',
    asker: theo,
    place: 'dm',
    facts: [
      {
        about: theo,
        text: 'is type 1 diabetic; meals and their timing matter to him.',
        importance: 5,
      },
    ],
    request: 'How many kilometres is five miles?',
    required: ['8'],
    forbidden: ['diabet', 'insulin'],
  },
  {
    id: 'family-restraint',
    kind: 'restraint',
    asker: maya,
    place: 'dm',
    facts: [
      {
        about: maya,
        text: 'lives with her partner Theo and their daughter Isla.',
        importance: 5,
      },
    ],
    request: 'Write me a haiku about autumn rain.',
    required: ['rain'],
    forbidden: ['Theo', 'Isla'],
  },
  {
    id: 'other-partner-gift',
    kind: 'attribution',
    asker: sam,
    place: 'room',
    facts: [
      {
        about: priya,
        text: 'lives with her partner Jonas, who loves climbing.',
        importance: 5,
      },
    ],
    request: 'What should I get my partner for her birthday?',
    required: [],
    forbidden: ['Jonas'],
  },
  {
    id: 'own-partner-sam',
    kind: 'attribution',
    asker: sam,
    place: 'room',
    facts: [
      {
        about: priya,
        text: 'lives with her partner Jonas, who loves climbing.',
        importance: 5,
      },
      {
        about: sam,
        text: 'lives with his partner Leila, who loves gardening.',
        importance: 5,
      },
    ],
    request: 'What should I get my partner for her birthday?',
    required: ['Leila', 'garden'],
    forbidden: ['Jonas'],
  },
  {
    id: 'own-partner-priya',
    kind: 'attribution',
    asker: priya,
    place: 'room',
    facts: [
      {
        about: priya,
        text: 'lives with her partner Jonas, who loves climbing.',
        importance: 5,
      },
      {
        about: sam,
        text: 'lives with his partner Leila, who loves gardening.',
        importance: 5,
      },
    ],
    request: 'Help me write a message to my partner about Friday.',
    required: ['Jonas'],
    forbidden: ['Leila'],
  },
  {
    id: 'other-allergy-dinner',
    kind: 'attribution',
    asker: sam,
    place: 'room',
    facts: [
      {
        about: priya,
        text: 'has a hazelnut allergy.',
        importance: 5,
      },
    ],
    request: "I'm cooking just for myself tonight. What should I make?",
    required: [],
    // Only a reply that applies Priya's allergy says these.
    forbidden: [
      'hazelnut-free',
      'hazelnut free',
      'nut-free',
      'nut free',
      'no hazelnut',
      'without hazelnut',
      'avoid hazelnut',
    ],
  },
]
