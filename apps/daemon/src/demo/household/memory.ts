// What each of the household's Familiars remembers about Rowan, a year in,
// so every Familiar's Memory pages have something to show. Juniper's is
// Rowan from the memory eval's rowan-v3 scenario; the others know their
// own corner of Rowan's life.

import { Type, defineTool } from '@familiar-ai/core'
import {
  Episodes,
  Facts,
  Familiars,
  familiarDoc,
  localDay,
  type Episode,
  type Fact,
  type FamiliarId,
} from '@familiar-ai/core/diagnostics'
import { DEMO_TIME_ZONE } from '../scenarios/scenario.ts'

/** The message the demo sends Juniper on start; the scripted model answers by calling both seed tools. */
export const SEED_MESSAGE =
  'Here is what to remember about me. (The demo sends this on start.)'

type Dated = [text: string, monthsAgo: number]

/** One Familiar's memory, dated back from today. */
export type MemorySeed = {
  /** Facts still true, with how many months ago they became true and their importance. */
  facts: [...Dated, importance: number][]
  /** Facts that changed, each version with when it became true; the last is still true. */
  changes?: { importance: number; versions: Dated[] }[]
  /** Facts that stopped being true with nothing to replace them. */
  retired?: [text: string, since: number, until: number, importance: number][]
  /** Facts the owner pins into core, through the same API as the Memory page. */
  pinned?: string[]
  /** Monthly episodes, oldest first, ending last month. */
  months?: string[]
  /** Weekly episodes, oldest first, ending last Sunday. */
  weeks?: string[]
  /** Daily episodes, oldest first, ending yesterday. */
  days?: string[]
}

const juniper: MemorySeed = {
  facts: [
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
  ],
  changes: [
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
  ],
  retired: [
    ['Commutes on the number 14 bus with a £64 monthly pass.', 11, 4, 2],
  ],
  pinned: [
    'Name is Rowan. Turned thirty in 2021.',
    'Retired greyhound Pip (racing name Silver Comet), home since 2019. Vet: Dr Celia Moss at Quarry Veterinary Practice.',
    'Mum, June, lives at 7 Orchard Close, Harrogate. Her wheelchair needs gates at least 84 cm wide and beds no higher than 60 cm.',
    'Saffron is allergic to hazelnuts, including hazelnut oil.',
  ],
  months: [
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
  ],
  weeks: [
    'Compared archive-paper suppliers: Quarry Paper is the only one with acid-free A3 in packs of 25 under £24 delivered.',
    'Recorded two dawn sessions at Tinsley locks for Canal Voices. Pottery class made the last bowls of the term.',
    'Long phone call with June about the garden; she wants work to start in spring.',
  ],
  days: [
    'Back at work. Mentioned the new binoculars and a fieldfare in the archive car park.',
    'Ada Finch asked Rowan to lead the spring condition survey. Noor texted: still no word from the landowner.',
    'Cycled in through frost. Booked June a call with Fenwick Gardens for next week.',
  ],
}

const quill: MemorySeed = {
  facts: [
    [
      'Rowan is collections environment coordinator at Westfold Archive; manager Ada Finch.',
      3,
      5,
    ],
    [
      'Leads the spring condition survey of the map stores; the plan is due to Ada by the end of November.',
      0,
      4,
    ],
    [
      'Wants inbox summaries in two lines, most urgent first, and no summaries at weekends.',
      2,
      3,
    ],
    [
      'Store B’s humidity logger syncs its readings to the archive NAS each night.',
      2,
      2,
    ],
    ['Archive paper comes from Quarry Paper: acid-free A3, packs of 25.', 1, 2],
  ],
  pinned: [
    'Rowan is collections environment coordinator at Westfold Archive; manager Ada Finch.',
  ],
  weeks: [
    'Scoped the condition survey with Ada: the map stores first, then the photographic store.',
    'Chased the Quarry Paper order and cleared a backlog of loan requests.',
  ],
  days: [
    'Store B’s humidity logger went offline overnight; facilities are looking at it.',
    'Drafted the survey timetable and booked the map-store keys for Thursday.',
  ],
}

const moss: MemorySeed = {
  facts: [
    [
      'Shares allotment plot 26B at Willow Bank with Saffron. The shed key is under the water butt.',
      9,
      4,
    ],
    [
      'Overwintering leeks, chard and purple sprouting broccoli on the plot.',
      1,
      3,
    ],
    [
      'June’s garden: Fenwick Gardens quoted £1,850 for 58 cm raised beds and an 88 cm gate.',
      4,
      4,
    ],
    [
      'June’s wheelchair needs gates at least 84 cm wide and beds no higher than 60 cm.',
      12,
      5,
    ],
    ['Saves borlotti bean seed each autumn in paper envelopes.', 6, 1],
  ],
  pinned: [
    'June’s wheelchair needs gates at least 84 cm wide and beds no higher than 60 cm.',
  ],
  months: [
    'A glut of courgettes; Saffron took most of them to the food bank.',
    'Lifted the potatoes and sowed green manure on the empty bed.',
  ],
  days: [
    'Fleeced the chard against the first frost.',
    'Walked June’s garden on a video call to measure the path.',
  ],
}

const spool: MemorySeed = {
  facts: [
    [
      'The printer lives in the box room. A 0.4 mm hardened steel nozzle has been on it since September.',
      2,
      3,
    ],
    [
      'PETG goes in the filament dryer at 65 °C for four hours before printing.',
      3,
      2,
    ],
    [
      'The hallway coat hook has snapped twice in PLA; it’s being reprinted in PETG with four walls.',
      0,
      3,
    ],
    ['Print files live on the NAS under /prints.', 5, 2],
  ],
  days: [
    'Calibrated the first layer after the nozzle swap.',
    'Printed a test hook in PETG; it held 8 kg overnight.',
  ],
}

/** Each Familiar's memory, by its name. */
export const memories: Record<string, MemorySeed> = {
  Juniper: juniper,
  Quill: quill,
  Moss: moss,
  Spool: spool,
}

// Calendar arithmetic on UTC dates, from today's day in the demo's zone.
const dayOf = (date: Date) => date.toISOString().slice(0, 10)
const todayAt = (at: number) =>
  new Date(`${localDay(at, DEMO_TIME_ZONE)}T00:00:00Z`)

/**
 * A Familiar's facts as the fact document holds them, dated back from now:
 * each true since the 10th of its month, and saved that day, as if upkeep
 * had kept up. Seeded facts cite no messages; the demo has none to cite.
 */
function factsAsOf(seed: MemorySeed, now: Date) {
  const monthsAgo = (count: number) =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - count, 10))
  const saved: Fact[] = []
  const save = (text: string, importance: number, since: Date) => {
    const fact: Fact = {
      id: `f${saved.length + 1}`,
      text,
      importance,
      since: dayOf(since),
      sources: [],
      saved: since.getTime(),
      core: false,
    }
    saved.push(fact)
    return fact
  }
  for (const { importance, versions } of seed.changes ?? []) {
    let previous: Fact | undefined
    for (const [text, ago] of versions) {
      const fact = save(text, importance, monthsAgo(ago))
      if (previous) {
        previous.until = fact.since
        fact.replaces = [previous.id]
      }
      previous = fact
    }
  }
  for (const [text, from, until, importance] of seed.retired ?? []) {
    save(text, importance, monthsAgo(from)).until = dayOf(monthsAgo(until))
  }
  for (const [text, ago, importance] of seed.facts) {
    save(text, importance, monthsAgo(ago))
  }
  return saved
}

const daysBefore = (date: Date, count: number) =>
  new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() - count,
    ),
  )

/** A Familiar's episodes, ending yesterday, as nightly upkeep would have written them. */
function episodesUntil(seed: MemorySeed, today: Date): Omit<Episode, 'id'>[] {
  const episodes: Omit<Episode, 'id'>[] = []
  const at = today.getTime()
  const months = seed.months ?? []
  months.forEach((text, index) => {
    const ago = months.length - index
    const [year, month] = [today.getUTCFullYear(), today.getUTCMonth()]
    const start = new Date(Date.UTC(year, month - ago, 1))
    const end = new Date(Date.UTC(year, month - ago + 1, 0))
    episodes.push({
      span: 'month',
      start: dayOf(start),
      end: dayOf(end),
      text,
      at,
    })
  })
  // The last full weeks, Monday to Sunday.
  const sunday = daysBefore(today, today.getUTCDay() || 7)
  const weeks = seed.weeks ?? []
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
  const days = seed.days ?? []
  days.forEach((text, index) => {
    const day = dayOf(daysBefore(today, days.length - index))
    episodes.push({ span: 'day', start: day, end: day, text, at })
  })
  return episodes
}

/** Each Familiar with a memory seed, by ID, from the registry. */
async function seeded(tx: Parameters<typeof familiarDoc>[0]) {
  const { familiars } = await tx.doc(Familiars)
  return Object.entries(familiars).flatMap(([id, { name }]) =>
    memories[name] ? [[Number(id) as FamiliarId, memories[name]] as const] : [],
  )
}

export const seedMemory = defineTool({
  name: 'seed_memory',
  description:
    'Demo only: fills each household Familiar’s memory with a sample year of facts.',
  parameters: Type.Object({}),
  execute: (_args, api, context) =>
    api.commit(async (tx) => {
      for (const [id, seed] of await seeded(tx)) {
        const memory = await familiarDoc(tx, Facts, id)
        memory.facts = factsAsOf(seed, todayAt(api.now()))
        memory.next = memory.facts.length + 1
      }
      return { output: [{ type: 'text', text: 'Memory written.' }] }
    }, context),
})

export const seedEpisodes = defineTool({
  name: 'seed_episodes',
  description:
    'Demo only: fills each household Familiar’s episodes with a sample year.',
  parameters: Type.Object({}),
  execute: (_args, api, context) =>
    api.commit(async (tx) => {
      for (const [id, seed] of await seeded(tx)) {
        const state = await familiarDoc(tx, Episodes, id)
        for (const episode of episodesUntil(seed, todayAt(api.now()))) {
          state.episodes.push({ id: `e${state.next++}`, ...episode })
        }
      }
      return { output: [{ type: 'text', text: 'Episodes written.' }] }
    }, context),
})
