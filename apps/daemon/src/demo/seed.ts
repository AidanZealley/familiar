// Sample memory for the demo, so the Memory pages have something to show:
// Rowan, from the memory eval's rowan-v3 scenario, a year in.

import { Type } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-durable'
import {
  Episodes,
  Memory,
  type Episode,
  type Fact,
} from '@familiar/core/diagnostics'

/** The message the demo sends itself on start; the scripted model answers by calling both seed tools. */
export const SEED_MESSAGE =
  'Here is what to remember about me. (The demo sends this on start.)'

type Dated = [text: string, monthsAgo: number]

/** Facts still true, with their importance and how long ago they were saved. */
const facts: [...Dated, importance: number][] = [
  ['Name is Rowan. Turned thirty in 2021.', 12, 5],
  [
    'Retired greyhound Pip (racing name Silver Comet), home since 2019. Vet: Dr Celia Moss at Quarry Veterinary Practice.',
    12,
    5,
  ],
  [
    'Mum, June, lives at 7 Orchard Close, Harrogate. Her wheelchair needs gates at least 84 cm wide and beds no higher than 60 cm.',
    12,
    5,
  ],
  ['Saffron is allergic to hazelnuts, including hazelnut oil.', 11, 2],
  [
    'Brother Ellis lives in Derby and restored Rowan’s green steel bicycle, Bracken.',
    12,
    4,
  ],
  [
    'Tuesday pottery class at 7 pm at Kiln House, taught by Asha Mistry.',
    11,
    3,
  ],
  [
    'Reed Shelter, a birdwatching hide with Noor Rahman, is paused until the landowner grants permission. Its roof panel must weigh 8 kg or less.',
    9,
    3,
  ],
  [
    'Canal Voices: a sound project recording lock gates and boat engines at dawn, for a six-track download. No release date.',
    8,
    3,
  ],
  [
    'Fenwick Gardens’ quote (£1,850, 58 cm beds, 88 cm gate) is the only one that fits June’s garden. No installer chosen yet.',
    11,
    4,
  ],
  ['Pip’s waterproof coat is size 66 cm, from Fell Houndwear.', 12, 1],
  [
    'Aunt Lorna’s silver thimble, engraved E.W., was left to Rowan in 2017.',
    12,
    2,
  ],
  [
    'Sewing machine is a Janome HD2200; size 90 denim needles for canvas.',
    12,
    1,
  ],
  [
    'Watch: a 1967 Timex Marlin, repaired by Inez Cole at Second Hand Time with a 19 mm oxblood leather strap.',
    10,
    2,
  ],
  [
    'Off-site backup: a 4 TB Toshiba Canvio Basics in the locked oak cabinet in Ellis’s upstairs study.',
    8,
    2,
  ],
  [
    'Uncle Basil’s 2008 lentil-soup postcard: half a teaspoon of ground fenugreek for four portions.',
    7,
    2,
  ],
  [
    'Railway timetables from Grandad Felix in 2012; catalogue prefix RH-MID.',
    6,
    2,
  ],
  ['Binoculars: Opticron Discovery 8x42.', 0, 1],
]

/** Facts that changed, each version with when it was saved; the last is still true. */
const changes: { importance: number; versions: Dated[] }[] = [
  {
    importance: 5,
    versions: [
      ['Lives at 18 Beech Terrace, Leeds; rent £725 a month.', 12],
      [
        'Lives at Flat 2, 9 Foss Lane, York; rent £860 a month. Landlord Ruth Venn.',
        11,
      ],
      ['Lives at 41 Rivelin Street, Sheffield; rent £910 a month.', 7],
      ['Lives at Flat 5, Kelham Court, Sheffield; rent £940 a month.', 2],
    ],
  },
  {
    importance: 4,
    versions: [
      [
        'Lab technician at Northbank Ceramics, testing glaze samples on an Orton ST-1 dilatometer.',
        12,
      ],
      [
        'Exhibition fabricator at Lantern Museum; workshop manager Ivo Chen.',
        11,
      ],
      [
        'Collections environment coordinator at Westfold Archive; manager Ada Finch.',
        3,
      ],
    ],
  },
  {
    importance: 2,
    versions: [
      ['Morning drink: coffee from a copper three-cup moka pot.', 12],
      ['Morning drink: rooibos.', 8],
      ['Morning drink: roasted barley tea.', 2],
    ],
  },
  {
    importance: 4,
    versions: [
      ['Partner is Saffron; they keep separate homes.', 12],
      [
        'Saffron and Rowan ended their relationship in April but remain friends and still share allotment plot 26B at Willow Bank.',
        9,
      ],
    ],
  },
]

/** A fact that stopped being true with nothing to replace it: saved, then retired. */
const retired: [
  text: string,
  saved: number,
  until: number,
  importance: number,
] = ['Commutes on the number 14 bus with a £64 monthly pass.', 11, 4, 2]

/** Facts the owner pins into core, through the same API as the Memory page. */
export const seedPinned = [
  'Name is Rowan. Turned thirty in 2021.',
  'Retired greyhound Pip (racing name Silver Comet), home since 2019. Vet: Dr Celia Moss at Quarry Veterinary Practice.',
  'Mum, June, lives at 7 Orchard Close, Harrogate. Her wheelchair needs gates at least 84 cm wide and beds no higher than 60 cm.',
  'Saffron is allergic to hazelnuts, including hazelnut oil.',
]

/** The demo's facts as the memory document holds them, dated back from now. */
function factsAsOf(now: Date) {
  const monthsAgo = (count: number) =>
    new Date(now.getFullYear(), now.getMonth() - count, 10).getTime()
  const saved: Fact[] = []
  const save = (text: string, importance: number, at: number) => {
    const fact: Fact = {
      id: `m${saved.length + 1}`,
      text,
      at,
      created: at,
      importance,
      core: false,
    }
    saved.push(fact)
    return fact
  }
  for (const { importance, versions } of changes) {
    let previous: Fact | undefined
    for (const [text, ago] of versions) {
      const fact = save(text, importance, monthsAgo(ago))
      if (previous) {
        previous.until = fact.at
        fact.replaces = [previous.id]
      }
      previous = fact
    }
  }
  const [text, from, until, importance] = retired
  save(text, importance, monthsAgo(from)).until = monthsAgo(until)
  for (const [text, ago, importance] of facts)
    save(text, importance, monthsAgo(ago))
  return saved
}

export const seedMemory = defineTool({
  name: 'seed_memory',
  description: 'Demo only: fills memory with a sample year of facts.',
  parameters: Type.Object({}),
  execute: (_args, api, context) =>
    api.commit(async (tx) => {
      const memory = await tx.doc(Memory)
      memory.facts = factsAsOf(new Date(api.now()))
      memory.next = memory.facts.length + 1
      return { output: [{ type: 'text', text: 'Memory written.' }] }
    }, context),
})

const months = [
  'Moved from Leeds to Foss Lane in York and left Northbank for Lantern Museum a week later. Started Tuesday pottery at Kiln House.',
  'Tidal Rooms went on show at the Riverside makers exhibition. Repaired flood-damaged atlases for the library, and began sketching Reed Shelter with Noor.',
  'Reed Shelter paused for want of the landowner’s permission. Built Paper Moon and played it at Cinder Hall. Rowan and Saffron ended their relationship but stayed friends.',
  'Started Canal Voices, recording lock gates at dawn. Switched to rooibos. Sorted the backup drives with Ellis.',
  'Moved to 41 Rivelin Street in Sheffield and started at Westfold Archive, under Ada Finch.',
  'Settled into Sheffield. Moved volunteering to Bell Street Library. Bought Saffron dark chocolate with orange peel for her birthday.',
  'A slow month at the allotment. Recorded the first full Canal Voices track.',
  'Started cycling to the archive along the Rivelin path. Cancelled Folded Atlas as a product and kept the prototype.',
  'Promoted to collections environment coordinator. Started looking for a flat closer to Kelham Island.',
  'Moved to Kelham Court and spent the month unpacking. Switched to roasted barley tea.',
  'A quiet month. Ordered archive paper from Quarry Paper and helped June plan the garden around Fenwick’s quote.',
]
const weeks = [
  'Compared archive-paper suppliers: Quarry Paper is the only one with acid-free A3 in packs of 25 under £24 delivered.',
  'Recorded two dawn sessions at Tinsley locks for Canal Voices. Pottery class made the last bowls of the term.',
  'Long phone call with June about the garden; she wants work to start in spring.',
]
const days = [
  'Back at work. Mentioned the new binoculars and a fieldfare in the archive car park.',
  'Ada Finch asked Rowan to lead the spring condition survey. Noor texted: still no word from the landowner.',
  'Cycled in through frost. Booked June a call with Fenwick Gardens for next week.',
]

const pad = (value: number) => String(value).padStart(2, '0')
const dayOf = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
const daysBefore = (date: Date, count: number) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() - count)

/** A year of episodes ending yesterday, as nightly upkeep would have written them. */
function episodesUntil(today: Date): Omit<Episode, 'id'>[] {
  const episodes: Omit<Episode, 'id'>[] = []
  const at = today.getTime()
  months.forEach((text, index) => {
    const ago = months.length - index
    const start = new Date(today.getFullYear(), today.getMonth() - ago, 1)
    const end = new Date(today.getFullYear(), today.getMonth() - ago + 1, 0)
    episodes.push({
      span: 'month',
      start: dayOf(start),
      end: dayOf(end),
      text,
      at,
    })
  })
  // The last full weeks, Monday to Sunday.
  const sunday = daysBefore(today, today.getDay() || 7)
  weeks.forEach((text, index) => {
    const end = daysBefore(sunday, (weeks.length - 1 - index) * 7)
    const start = daysBefore(end, 6)
    episodes.push({
      span: 'week',
      start: dayOf(start),
      end: dayOf(end),
      text,
      at,
    })
  })
  days.forEach((text, index) => {
    const day = dayOf(daysBefore(today, days.length - index))
    episodes.push({ span: 'day', start: day, end: day, text, at })
  })
  return episodes
}

export const seedEpisodes = defineTool({
  name: 'seed_episodes',
  description: 'Demo only: fills the episodes with a sample year.',
  parameters: Type.Object({}),
  execute: (_args, api, context) =>
    api.commit(async (tx) => {
      const state = await tx.doc(Episodes)
      for (const episode of episodesUntil(new Date(api.now())))
        state.episodes.push({ id: `e${state.next++}`, ...episode })
      return { output: [{ type: 'text', text: 'Episodes written.' }] }
    }, context),
})
