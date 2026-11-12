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
 *   Run with its facts in core, with them just outside it, and with memory
 *   empty. The first against the last is the memory gain; the second against
 *   the first is how much recall rescues what core no longer holds.
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
  /**
   * Context rather than the fact under test: it stays as rated in every
   * placement, so it crowds core without being moved in or out of it.
   */
  background?: boolean
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

/**
 * Every proactive probe says beside it whether its request shares a word
 * with its fact. Automatic recall is word search (BM25), so with the fact
 * outside core it can rescue a probe that shares a word and is blind to one
 * that doesn't, which then depends on the model asking for memory itself.
 * The probes are mixed on purpose: the rescue rate has to be able to move
 * either way when recall changes.
 */
export const probes: UseProbe[] = [
  {
    id: 'allergy-dinner',
    // Shares no word: the plainest dinner request vs a severe allergy, the case recall's word search
    // is most likely to miss and the one that matters most.
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
    // Shares "partner".
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
    // Shares no word: "birthday party" never says "daughter" or her name.
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
    // Shares no word: "lunch" vs a condition that shapes meals.
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
    // Shares no word, and both facts are needed: a reply keeping either in mind passes.
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
    // Shares "Friday". Rated below core's threshold, so only recall can bring it up.
    kind: 'proactive',
    asker: maya,
    place: 'dm',
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
    // Shares no word: "mum" vs "mother". Core is crowded by background facts, one of
    // which shares "Sunday" with the request, so the fact under test also has to win a
    // place in core, or in recall, among rivals.
    kind: 'proactive',
    asker: maya,
    place: 'dm',
    facts: [
      {
        about: maya,
        text: 'has a mother, June, who uses a wheelchair and needs step-free access.',
        importance: 5,
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
        background: true,
      })),
    ],
    request: 'Find somewhere for lunch with my mum on Sunday.',
    required: ['wheelchair', 'step-free', 'step free'],
    forbidden: [],
  },
  {
    id: 'sister-dinner',
    kind: 'proactive',
    // Shares "sister". A relative's diet is the kind of fact people expect remembered.
    asker: maya,
    place: 'dm',
    facts: [
      {
        about: maya,
        text: 'has a sister, Nora, who is vegetarian.',
        importance: 4,
      },
    ],
    request: 'My sister is coming for dinner on Saturday. What should I cook?',
    // Her name only: a reply without memory can hedge "if she is
    // vegetarian", but can't know she's called Nora.
    required: ['Nora'],
    forbidden: [],
  },
  {
    id: 'coffee-order',
    kind: 'proactive',
    // Shares "coffee". A minor preference rated below core's threshold from the
    // start, the kind of fact recall exists for.
    asker: maya,
    place: 'dm',
    facts: [
      {
        about: maya,
        text: 'likes her coffee as an oat-milk flat white.',
        importance: 2,
      },
    ],
    request: 'Write a quick note for the barista with my usual coffee order.',
    required: ['oat', 'flat white'],
    forbidden: [],
  },
  {
    id: 'lunchbox',
    kind: 'proactive',
    // Shares "Isla". A child's dislike, stated once and mildly: the smallest fact a
    // reply can still honour.
    asker: maya,
    place: 'dm',
    facts: [
      {
        about: maya,
        text: 'says her daughter Isla hates mushrooms.',
        importance: 3,
      },
    ],
    request: "What can I put in Isla's lunchbox this week?",
    required: ['mushroom'],
    forbidden: [],
  },
  {
    id: 'dog-evening',
    kind: 'proactive',
    // Shares no word: "evening after work" vs a daily 6pm walk. A routine
    // that shapes how an evening is planned, which the request never names.
    asker: maya,
    place: 'dm',
    facts: [
      {
        about: maya,
        text: 'has a dog, Biscuit, who needs a walk at 6pm every day.',
        importance: 4,
      },
    ],
    request: 'Help me plan my evening after work.',
    required: ['Biscuit', 'your dog', 'dog walk', 'walk the dog'],
    forbidden: [],
  },
  {
    id: 'film-night',
    kind: 'proactive',
    // Shares no word: "film tonight" vs a bedtime. A household constraint
    // on an ordinary entertainment request.
    asker: maya,
    place: 'dm',
    facts: [
      {
        about: maya,
        text: 'puts her daughter Isla to bed at 7:30pm on school nights.',
        importance: 4,
      },
    ],
    request: 'Suggest a film for us to watch tonight.',
    required: ['Isla', '7:30'],
    forbidden: [],
  },
  // Thirty proactive probes in all, so that a rate moves in steps of a few points. Each of
  // these says what it tests, whether its request shares a word with its fact, and rates its
  // fact as upkeep might. Required strings are names a reply can only know from the fact.
  {
    id: 'nephew-gift',
    kind: 'proactive',
    // Shares no word: "nephew" never says "sister", and the child's name is the proof.
    // A relative's child is the kind of detail people expect remembered.
    asker: maya,
    place: 'dm',
    facts: [
      {
        about: maya,
        text: 'has a sister, Nora, whose baby son Ezra turns one in April.',
        importance: 4,
      },
    ],
    request: "I need a present idea for my nephew's first birthday.",
    required: ['Ezra'],
    forbidden: [],
  },
  {
    id: 'mum-flowers',
    kind: 'proactive',
    // Shares no word: "flowers" vs "florist", and "Mum" vs "mother". A named shop is
    // the one thing a reply can't guess.
    asker: maya,
    place: 'dm',
    facts: [
      {
        about: maya,
        text: "says her mother June's favourite florist is Petal & Stem on Hope Street.",
        importance: 3,
      },
    ],
    request: "Where should I order flowers for Mum's birthday?",
    required: ['Petal'],
    forbidden: [],
  },
  {
    id: 'theo-commute',
    kind: 'proactive',
    // Shares no word: how he travels vs a meeting across town. Kit that decides a route.
    asker: theo,
    place: 'dm',
    facts: [
      {
        about: theo,
        text: 'rides a Brompton folding bike to work and keeps it in the hallway.',
        importance: 3,
      },
    ],
    request: 'How should I get across town for a 9am meeting?',
    required: ['Brompton'],
    forbidden: [],
  },
  {
    id: 'weekend-lie-in',
    kind: 'proactive',
    // Shares no word: "weekend" vs a Saturday lesson. A standing commitment that
    // quietly rules out the request.
    asker: maya,
    place: 'dm',
    facts: [
      {
        about: maya,
        text: 'takes Isla to swimming lessons at Riverside Leisure Centre every Saturday at 9am.',
        importance: 4,
      },
    ],
    request: 'Can we fit in a proper lie-in this weekend?',
    required: ['Riverside', 'swimming lesson', 'swim lesson'],
    forbidden: [],
  },
  {
    id: 'bedtime-rabbit',
    kind: 'proactive',
    // Shares no word: "my daughter can't settle" vs a toy rabbit's name. The smallest
    // household detail that makes advice personal.
    asker: maya,
    place: 'dm',
    facts: [
      {
        about: maya,
        text: "says Isla can't sleep without her toy rabbit, Pemberton.",
        importance: 3,
      },
    ],
    request: "My daughter can't settle at bedtime. Any ideas?",
    required: ['Pemberton'],
    forbidden: [],
  },
  {
    id: 'locked-out',
    kind: 'proactive',
    // Shares no word: "locked out" vs a spare key. A time when the fact matters
    // most and nobody thinks to mention it.
    asker: maya,
    place: 'dm',
    facts: [
      {
        about: maya,
        text: 'has a neighbour, Mrs Kowalski, who keeps a spare house key.',
        importance: 4,
      },
    ],
    request: "I'm locked out and Theo isn't picking up. What do I do?",
    required: ['Kowalski'],
    forbidden: [],
  },
  {
    id: 'gp-checkup',
    kind: 'proactive',
    // Shares no word: "check-up" vs the doctor's name. A person's own doctor is
    // something they'd expect an assistant to know.
    asker: maya,
    place: 'dm',
    facts: [
      {
        about: maya,
        text: 'is registered with Dr Okonkwo at Stanmore Surgery.',
        importance: 3,
      },
    ],
    request: 'Can you help me book a check-up for next week?',
    required: ['Okonkwo', 'Stanmore'],
    forbidden: [],
  },
  {
    id: 'wedding-stay',
    kind: 'proactive',
    // Shares no word: a wedding date vs a brother's spare room in another city. Family
    // who could host is the kind of fact only memory connects to the request.
    asker: theo,
    place: 'dm',
    facts: [
      {
        about: theo,
        text: 'has a brother, Kofi, with a spare room in Bristol.',
        importance: 3,
      },
    ],
    request: 'Where can we stay for the 14 February wedding?',
    required: ['Kofi'],
    forbidden: [],
  },
  {
    id: 'piano-wednesday',
    kind: 'proactive',
    // Shares "Wednesday". A weekly lesson rated low, the kind of commitment recall exists for.
    asker: maya,
    place: 'dm',
    facts: [
      {
        about: maya,
        text: 'takes Isla to piano lessons with Mr Adeyemi on Wednesdays at 4:30pm.',
        importance: 3,
      },
    ],
    request: 'Can you plan our Wednesday after school for me?',
    required: ['piano', 'Adeyemi'],
    forbidden: [],
  },
  {
    id: 'bouldering-tuesday',
    kind: 'proactive',
    // Shares "Tuesday" and "evening". A hobby slot that a day's plan has to work around.
    asker: maya,
    place: 'dm',
    facts: [
      {
        about: maya,
        text: 'goes bouldering at The Arch on Tuesday evenings.',
        importance: 2,
      },
    ],
    request: 'Help me plan my Tuesday evening.',
    required: ['The Arch', 'boulder'],
    forbidden: [],
  },
  {
    id: 'book-club-drinks',
    kind: 'proactive',
    // Shares "Thursday". A monthly commitment on a day the request would otherwise fill.
    asker: maya,
    place: 'dm',
    facts: [
      {
        about: maya,
        text: 'is in a book club that meets on the first Thursday of every month.',
        importance: 3,
      },
    ],
    request:
      'Suggest a date for work drinks. The first Thursday of the month suits the team.',
    required: ['book club'],
    forbidden: [],
  },
  {
    id: 'anniversary-plan',
    kind: 'proactive',
    // Shares "anniversary". A date people expect remembered, which a reply can't guess.
    asker: maya,
    place: 'dm',
    facts: [
      {
        about: maya,
        text: 'and Theo married on 9 June, so their anniversary is then.',
        importance: 4,
      },
    ],
    request: 'Help me plan something for our anniversary.',
    required: ['9 June', 'June 9'],
    forbidden: [],
  },
  {
    id: 'allotment-note',
    kind: 'proactive',
    // Shares "allotment". A named person the request refers to only by role.
    asker: maya,
    place: 'dm',
    facts: [
      {
        about: maya,
        text: 'shares her allotment with a neighbour, Gwen.',
        importance: 2,
      },
    ],
    request: 'Draft a note for the person I share my allotment with.',
    required: ['Gwen'],
    forbidden: [],
  },
  {
    id: 'school-run-email',
    kind: 'proactive',
    // Shares "Monday". A school's name is a fact a draft has to get right.
    asker: maya,
    place: 'dm',
    facts: [
      {
        about: maya,
        text: 'does the school run to Hollin Primary on Mondays.',
        importance: 3,
      },
    ],
    request: "Draft an email to Isla's school about Monday pickup.",
    required: ['Hollin'],
    forbidden: [],
  },
  {
    id: 'date-night',
    kind: 'proactive',
    // Shares "babysitter". A trusted person's name, the thing a booking message needs.
    asker: maya,
    place: 'dm',
    facts: [
      {
        about: maya,
        text: 'uses a babysitter, Chloe, for date nights.',
        importance: 3,
      },
    ],
    request: 'Draft a message to our babysitter for Saturday night.',
    required: ['Chloe'],
    forbidden: [],
  },
  {
    id: 'theo-mum-invite',
    kind: 'proactive',
    // Shares "Theo's mum". An in-law's name and place, which an invitation uses.
    asker: maya,
    place: 'dm',
    facts: [
      {
        about: theo,
        text: 'has a mum, Grace, who lives in Swansea.',
        importance: 3,
      },
    ],
    request: "Draft a text inviting Theo's mum to stay at Easter.",
    required: ['Grace'],
    forbidden: [],
  },
  {
    id: 'theo-gift',
    kind: 'proactive',
    // Shares "Theo". Something he owns and loves, which narrows a gift to what fits it.
    asker: maya,
    place: 'dm',
    facts: [
      {
        about: theo,
        text: 'collects jazz records and plays them on a Rega turntable.',
        importance: 3,
      },
    ],
    request: 'Suggest a birthday gift for Theo.',
    required: ['Rega'],
    forbidden: [],
  },
  {
    id: 'client-email',
    kind: 'proactive',
    // Shares "client". A work contact's name, which a draft to them needs.
    asker: maya,
    place: 'dm',
    facts: [
      {
        about: maya,
        text: 'has a client contact at Brightwell called Imogen Hart.',
        importance: 3,
      },
    ],
    request:
      'Draft an email to my client contact asking for a deadline extension.',
    required: ['Imogen'],
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
    // A haiku need not use the word "rain", so nothing is required of it.
    required: [],
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
    // Concrete enough that a draft is the natural reply: "a message about
    // Friday" is rightly answered with questions, which never name anyone.
    request: "Write a short message to my partner saying I can't make Friday.",
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
