import type { Author } from '@familiar-ai/core'

/**
 * The core-quality scenario: two months of a household's messages, labelled
 * with where each lasting thing said should end up in memory. Labels sit
 * beside the message that first says it; later messages mention some items
 * again without labels, so recall marks them used as it would in real life.
 *
 * Two kinds of item exist for ranking under pressure rather than filing:
 * - A `fades` item is not named again once its date has passed, so any use
 *   after that is only recall matching its words. Recall counts that as use,
 *   a known problem for step 5; the grade reports it as `fadesRefreshed`
 *   rather than hiding it.
 * - `mum-access` is a `core` item said once and never again. A ranking that
 *   favours what is used will push it out when core is short.
 */

/**
 * Where an item belongs once upkeep has filed the scenario:
 * - `core`: identity, close people, health; always in the prompt.
 * - `recall`: lasting but situational; stored, recalled when relevant.
 * - `none`: passing chatter, or what Familiar's own state would hold.
 * - `fades`: important early, then never mentioned again; out of core by the end.
 */
export type Placement = 'core' | 'recall' | 'none' | 'fades'

/**
 * A labelled item. A fact matches it when its text contains any of `match`,
 * ignoring case, so each string must be specific to the item. A `changes`
 * item is superseded mid-scenario: by the end, a current fact should say
 * `to`, and none should still say any of `from` alone. `from` names the old
 * value as a current claim ("lives at 14 Elm Row"), not just the old value,
 * so a true fact about the past, such as work done at the old house,
 * doesn't count as stale.
 */
export type Item =
  | { id: string; label: Placement; match: [string] | [string, string] }
  | { id: string; label: 'changes'; from: string[]; to: string }

export type Label = Item['label']

export type CoreMessage = {
  /** The owner or the other person. */
  by: 'owner' | 'other'
  /** Their DM with the Familiar, or the room they share with it. */
  in: 'dm' | 'room'
  text: string
  /** What this message first says that memory should place. */
  items?: Item[]
}

export type CoreScenario = {
  id: string
  owner: Author
  other: Author
  /** The first and last calendar days; upkeep runs every night between. */
  start: string
  end: string
  /** Only the days anyone talks, in order; the clock jumps over the rest. */
  days: { date: string; messages: CoreMessage[] }[]
}

/** Every labelled item, in the order the scenario introduces them. */
export const itemsOf = (scenario: CoreScenario) =>
  scenario.days.flatMap((day) =>
    day.messages.flatMap((message) => message.items ?? []),
  )

/** Everything people said, for the memory-to-transcript size ratio. */
export const transcriptOf = (scenario: CoreScenario) =>
  scenario.days
    .flatMap((day) => day.messages.map((message) => message.text))
    .join('\n')

export const mayaV1: CoreScenario = {
  id: 'maya-v1',
  owner: { id: 'maya', name: 'Maya' },
  other: { id: 'theo', name: 'Theo' },
  start: '2026-01-05',
  end: '2026-03-05',
  days: [
    {
      date: '2026-01-05',
      messages: [
        {
          by: 'owner',
          in: 'dm',
          text: "Hi! I'm Maya Okafor, nice to meet you properly. I live at 14 Elm Row with my partner Theo and our daughter Isla, who's seven.",
          items: [
            { id: 'owner-name', label: 'core', match: ['Okafor'] },
            { id: 'partner', label: 'core', match: ['partner'] },
            { id: 'daughter', label: 'core', match: ['Isla'] },
            {
              id: 'home',
              label: 'changes',
              from: [
                'lives at 14 Elm Row',
                'live at 14 Elm Row',
                'living at 14 Elm Row',
                'home is 14 Elm Row',
                'home at 14 Elm Row',
              ],
              to: 'Quarry Lane',
            },
          ],
        },
        {
          by: 'owner',
          in: 'dm',
          text: 'Important: I have a severe peanut allergy and carry an EpiPen. Please always keep that in mind when we talk about food.',
          items: [{ id: 'allergy', label: 'core', match: ['peanut'] }],
        },
        {
          by: 'owner',
          in: 'dm',
          text: "Big news, Theo and I are flying to Lisbon on 23 January for our tenth anniversary. I'm so excited, I've been planning it for months.",
          items: [{ id: 'lisbon', label: 'fades', match: ['Lisbon'] }],
        },
        {
          by: 'owner',
          in: 'dm',
          text: "Day to day: I freelance as a designer and my main client is Brightwell Agency. Isla's at Greenfield Primary and I do the school run.",
          items: [
            {
              id: 'client',
              label: 'changes',
              from: ['Brightwell'],
              to: 'Corvid',
            },
            {
              id: 'isla-school',
              label: 'changes',
              from: ['Greenfield'],
              to: 'Hollin',
            },
          ],
        },
      ],
    },
    {
      date: '2026-01-06',
      messages: [
        {
          by: 'other',
          in: 'dm',
          text: "Hey, Theo here. Worth knowing: I'm type 1 diabetic, so if I ever ask about meals or timing, that's why.",
          items: [{ id: 'theo-health', label: 'core', match: ['diabet'] }],
        },
        {
          by: 'other',
          in: 'dm',
          text: 'I work early shifts at Crumb & Co, the bakery on Mill Street. Up at 4 most days.',
          items: [
            {
              id: 'theo-job',
              label: 'changes',
              from: ['Crumb'],
              to: 'Spoke Cycles',
            },
          ],
        },
        {
          by: 'other',
          in: 'room',
          text: 'Ugh, my umbrella blew inside out on the way to work this morning.',
          items: [{ id: 'umbrella', label: 'none', match: ['umbrella'] }],
        },
        {
          by: 'other',
          in: 'dm',
          text: "We've got a green Skoda Octavia, my pride and joy, even if it drinks petrol.",
        },
      ],
    },
    {
      date: '2026-01-08',
      messages: [
        {
          by: 'owner',
          in: 'dm',
          text: 'Can you set up a daily digest for me at 7pm? Just a round-up of my day.',
          items: [
            { id: 'digest-schedule', label: 'none', match: ['7pm', '7 pm'] },
          ],
        },
        {
          by: 'owner',
          in: 'dm',
          text: 'And when you do digests or summaries, keep them to five bullet points at most. I skim.',
          items: [
            {
              id: 'digest-style',
              label: 'recall',
              match: ['five bullet', '5 bullet'],
            },
          ],
        },
        {
          by: 'owner',
          in: 'dm',
          text: "I've got a big job interview at Halden Studio on 14 January for a senior designer role. It matters a lot to me.",
          items: [{ id: 'interview', label: 'fades', match: ['Halden'] }],
        },
        {
          by: 'owner',
          in: 'dm',
          text: "My tax return is due on 31 January and I haven't started it. Nudge me?",
          items: [{ id: 'tax', label: 'fades', match: ['tax return'] }],
        },
      ],
    },
    {
      date: '2026-01-12',
      messages: [
        {
          by: 'owner',
          in: 'room',
          text: "We're redoing the kitchen. The builder is Fenwick & Sons, budget £18,000, and they start on 2 February.",
          items: [{ id: 'kitchen', label: 'recall', match: ['Fenwick'] }],
        },
        {
          by: 'other',
          in: 'room',
          text: 'Had a tuna sandwich for lunch, nothing exciting.',
          items: [{ id: 'lunch', label: 'none', match: ['tuna'] }],
        },
        {
          by: 'owner',
          in: 'dm',
          text: "Prep for Halden is going well. I'm nervous about the portfolio review part of the Halden interview though.",
        },
        {
          by: 'owner',
          in: 'dm',
          text: 'Something to keep in mind: my mum June uses a wheelchair, so step-free access matters wherever she comes with us.',
          items: [{ id: 'mum-access', label: 'core', match: ['wheelchair'] }],
        },
        {
          by: 'owner',
          in: 'dm',
          text: 'Our GP is Dr Patel at Stanmore Surgery, in case you ever help me book anything.',
          items: [
            { id: 'gp', label: 'changes', from: ['Stanmore'], to: 'Highfield' },
          ],
        },
        {
          by: 'owner',
          in: 'room',
          text: 'The boiler engineer is booked for Thursday 29 January, between 8 and 12.',
          items: [{ id: 'boiler', label: 'fades', match: ['boiler'] }],
        },
        {
          by: 'other',
          in: 'room',
          text: 'The queue at the post office took forty minutes today.',
          items: [{ id: 'post-office', label: 'none', match: ['post office'] }],
        },
      ],
    },
    {
      date: '2026-01-15',
      messages: [
        {
          by: 'owner',
          in: 'dm',
          text: 'I took up bouldering last month and I go to The Arch on Tuesday evenings. Climbing V3 now.',
          items: [
            {
              id: 'bouldering',
              label: 'recall',
              match: ['boulder', 'The Arch'],
            },
          ],
        },
        {
          by: 'other',
          in: 'room',
          text: "My band Low Tide has a gig at the Fleece on 7 February. I play bass. You're both coming, right?",
          items: [{ id: 'band', label: 'recall', match: ['Low Tide'] }],
        },
        {
          by: 'owner',
          in: 'dm',
          text: 'Mum lives in Harrow, so a Sunday visit means a long drive across London.',
          items: [
            {
              id: 'mum-home',
              label: 'changes',
              from: ['Harrow'],
              to: 'Ealing',
            },
          ],
        },
        {
          by: 'owner',
          in: 'dm',
          text: 'For school forms: Isla has asthma and carries a blue inhaler.',
          items: [{ id: 'isla-asthma', label: 'core', match: ['asthma'] }],
        },
      ],
    },
    {
      date: '2026-01-21',
      messages: [
        {
          by: 'owner',
          in: 'dm',
          text: 'Packing for Lisbon now. Can you suggest snacks for the flight that are safe with my peanut allergy?',
        },
        {
          by: 'owner',
          in: 'room',
          text: "It's raining sideways out there. Isla refused to wear her coat.",
          items: [{ id: 'weather', label: 'none', match: ['raining', 'coat'] }],
        },
        {
          by: 'owner',
          in: 'dm',
          text: 'Please put my sister Nora in Leeds down as our emergency contact for anything official.',
          items: [{ id: 'emergency-contact', label: 'core', match: ['Nora'] }],
        },
        {
          by: 'owner',
          in: 'dm',
          text: "Isla's dentist appointment is on 3 February at 4pm.",
          items: [{ id: 'dentist', label: 'fades', match: ['dentist'] }],
        },
        {
          by: 'other',
          in: 'room',
          text: 'Stuck in traffic on the ring road for an hour, ugh.',
          items: [{ id: 'traffic', label: 'none', match: ['traffic'] }],
        },
      ],
    },
    {
      date: '2026-01-28',
      messages: [
        {
          by: 'owner',
          in: 'dm',
          text: "I'm in a book club that meets the first Thursday of every month. This month's book is Piranesi.",
          items: [{ id: 'book-club', label: 'recall', match: ['book club'] }],
        },
        {
          by: 'other',
          in: 'dm',
          text: 'A parcel from the camera shop should arrive Friday, can you remind me to look out for it?',
          items: [{ id: 'parcel', label: 'none', match: ['parcel'] }],
        },
        {
          by: 'owner',
          in: 'dm',
          text: 'Our broadband is with Zipnet and it has been dropping out all week.',
          items: [
            {
              id: 'broadband',
              label: 'changes',
              from: ['Zipnet'],
              to: 'Orbit',
            },
          ],
        },
        {
          by: 'owner',
          in: 'dm',
          text: 'I go to a pottery class at Kiln House every Friday evening.',
          items: [{ id: 'pottery', label: 'recall', match: ['Kiln House'] }],
        },
        {
          by: 'owner',
          in: 'dm',
          text: "Isla's school trip to Ironbridge is on 12 February and the £25 is due by the 5th.",
          items: [{ id: 'school-trip', label: 'fades', match: ['Ironbridge'] }],
        },
        {
          by: 'owner',
          in: 'dm',
          text: "Doing my tax return tonight, it's due on Saturday.",
        },
      ],
    },
    {
      date: '2026-02-02',
      messages: [
        {
          by: 'owner',
          in: 'room',
          text: 'Fenwick started on the kitchen today. Dust everywhere already.',
        },
        {
          by: 'owner',
          in: 'dm',
          text: 'Quick one: can you give me the digest as bullets tonight? Remember, five at most.',
        },
        {
          by: 'owner',
          in: 'room',
          text: "Isla's class assembly is on Friday 6 February and she has a speaking part!",
          items: [{ id: 'assembly', label: 'fades', match: ['assembly'] }],
        },
        {
          by: 'owner',
          in: 'dm',
          text: 'Isla has piano lessons on Wednesdays at 4:30 with Mr Adeyemi. Can you remember that for pickups?',
          items: [{ id: 'piano', label: 'recall', match: ['piano'] }],
        },
        {
          by: 'other',
          in: 'dm',
          text: "My cousin Dele's wedding is on 14 February in Bristol, so we'll need a plan for Isla.",
          items: [{ id: 'wedding', label: 'fades', match: ['wedding'] }],
        },
        {
          by: 'other',
          in: 'room',
          text: 'Ordered a takeaway pizza and it turned up cold.',
          items: [{ id: 'pizza', label: 'none', match: ['pizza'] }],
        },
      ],
    },
    {
      date: '2026-02-07',
      messages: [
        {
          by: 'other',
          in: 'room',
          text: 'Low Tide gig tonight! Soundcheck at 6. Maya, can you bring Isla by 8?',
        },
        {
          by: 'owner',
          in: 'room',
          text: 'Yes, Isla and I will be there by 8.',
        },
      ],
    },
    {
      date: '2026-02-11',
      messages: [
        {
          by: 'other',
          in: 'dm',
          text: "Big change: I've left the bakery. From Monday I'm a mechanic at Spoke Cycles on the high street. No more 4am starts.",
        },
        {
          by: 'other',
          in: 'dm',
          text: 'My new hours mean I eat lunch at 1 now; useful to know with the diabetes.',
        },
      ],
    },
    {
      date: '2026-02-16',
      messages: [
        {
          by: 'owner',
          in: 'dm',
          text: "We've found a new place! We're moving to 3 Quarry Lane on 1 March. The kitchen work at Elm Row was for the landlord in the end.",
        },
        {
          by: 'owner',
          in: 'room',
          text: 'Bouldering at The Arch tonight, finally sent my first V4.',
        },
        {
          by: 'owner',
          in: 'dm',
          text: 'Isla will start at Hollin Primary after half-term, since Quarry Lane is in its catchment.',
        },
        {
          by: 'other',
          in: 'dm',
          text: 'We bought a second-hand Nissan Leaf, so no more petrol. Much better for the city.',
        },
      ],
    },
    {
      date: '2026-02-20',
      messages: [
        {
          by: 'other',
          in: 'room',
          text: 'Planning dinner for Saturday. Maya, anything to avoid besides the peanuts?',
        },
        {
          by: 'owner',
          in: 'room',
          text: 'Just peanuts. And Isla hates mushrooms, but that is negotiable.',
        },
        {
          by: 'owner',
          in: 'dm',
          text: "We've got an allotment, plot 12 on Mill Lane, and I water it on Sunday mornings.",
          items: [{ id: 'allotment', label: 'recall', match: ['allotment'] }],
        },
        {
          by: 'owner',
          in: 'dm',
          text: 'Mum has moved into a ground-floor flat in Ealing, so Sunday visits are a different drive now.',
        },
        {
          by: 'owner',
          in: 'dm',
          text: "Isla's cough is back. Her asthma always flares in this cold.",
        },
      ],
    },
    {
      date: '2026-02-26',
      messages: [
        {
          by: 'owner',
          in: 'dm',
          text: "Book club is next Thursday and I haven't finished Piranesi. Help me plan reading time?",
        },
        {
          by: 'other',
          in: 'dm',
          text: 'Spoke Cycles is busy with spring tune-ups already. Loving it though.',
        },
        {
          by: 'owner',
          in: 'dm',
          text: 'Corvid Labs is my main client now, so my Monday calls are with them.',
        },
        {
          by: 'owner',
          in: 'room',
          text: "Pottery is tomorrow night and I'm glazing my first mug.",
        },
      ],
    },
    {
      date: '2026-03-01',
      messages: [
        {
          by: 'owner',
          in: 'room',
          text: "Moving day! We're in at 3 Quarry Lane. Boxes everywhere.",
        },
        {
          by: 'other',
          in: 'room',
          text: 'Keys for Quarry Lane are on the hook by the door. The corner shop is right outside, at least.',
        },
        {
          by: 'owner',
          in: 'dm',
          text: "We've registered with Highfield Medical Centre now that we're on Quarry Lane.",
        },
        {
          by: 'owner',
          in: 'dm',
          text: 'Orbit Fibre installed our new broadband this morning.',
        },
      ],
    },
    {
      date: '2026-03-04',
      messages: [
        {
          by: 'owner',
          in: 'dm',
          text: "Isla's school asked for allergy info for a class party. Can you draft a note about my peanut allergy for her teacher, saying we avoid peanuts at home?",
        },
        {
          by: 'owner',
          in: 'dm',
          text: 'And send me tonight’s digest as five bullets, as usual.',
        },
        {
          by: 'owner',
          in: 'dm',
          text: "Piano lesson this afternoon. Can you remind me to pack Isla's music book?",
        },
      ],
    },
  ],
}
