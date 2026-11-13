// What each of the household's Familiars remembers about Rowan, a year in,
// so every Familiar's Memory pages have something to show. Juniper's is
// Rowan from the memory eval's rowan-v3 scenario; the others know their
// own corner of Rowan's life.

import { Type, defineTool } from '@familiar-ai/core'
import {
  Familiars,
  keyOf,
  localDay,
  memoryOf,
  Pages,
  type FamiliarId,
  type Note,
} from '@familiar-ai/core/diagnostics'
import { OWNER_ID } from '../../serve.ts'
import { DEMO_TIME_ZONE } from '../scenarios/scenario.ts'

/** The message the demo sends Juniper on start; the scripted model answers by calling the seed tool. */
export const SEED_MESSAGE =
  'Here is what to remember about me. (The demo sends this on start.)'

type Dated = [text: string, monthsAgo: number]

/** One Familiar's memory of its owner, dated back from today. */
export type MemorySeed = {
  /** Notes still true, with how many months ago they became true. */
  facts: Dated[]
  /** Notes that changed, each version with when it became true; the last is still true. */
  changes?: { versions: Dated[] }[]
  /** Notes that stopped being true with nothing to replace them. */
  retired?: [text: string, since: number, until: number][]
  /** What its profile of the owner says, as consolidation would have written it. */
  pinned?: string[]
}

const juniper: MemorySeed = {
  facts: [
    ['Name is Rowan. Turned thirty in 2021.', 12],
    [
      'Retired greyhound Pip (racing name Silver Comet), home since 2019. Vet: Dr Celia Moss at Quarry Veterinary Practice.',
      12,
    ],
    [
      'Mum, June, lives at 7 Orchard Close, Harrogate. Her wheelchair needs gates at least 84 cm wide and beds no higher than 60 cm.',
      12,
    ],
    ['Saffron is allergic to hazelnuts, including hazelnut oil.', 11],
    [
      'Brother Ellis lives in Derby and restored Rowan’s green steel bicycle, Bracken.',
      12,
    ],
    ['Tuesday pottery class at 7 pm at Kiln House, taught by Asha Mistry.', 11],
    [
      'Reed Shelter, a birdwatching hide with Noor Rahman, is paused until the landowner grants permission. Its roof panel must weigh 8 kg or less.',
      9,
    ],
    [
      'Canal Voices: a sound project recording lock gates and boat engines at dawn, for a six-track download. No release date.',
      8,
    ],
    [
      'Fenwick Gardens’ quote (£1,850, 58 cm beds, 88 cm gate) is the only one that fits June’s garden. No installer chosen yet.',
      11,
    ],
    ['Pip’s waterproof coat is size 66 cm, from Fell Houndwear.', 12],
    [
      'Aunt Lorna’s silver thimble, engraved E.W., was left to Rowan in 2017.',
      12,
    ],
    [
      'Sewing machine is a Janome HD2200; size 90 denim needles for canvas.',
      12,
    ],
    [
      'Watch: a 1967 Timex Marlin, repaired by Inez Cole at Second Hand Time with a 19 mm oxblood leather strap.',
      10,
    ],
    [
      'Off-site backup: a 4 TB Toshiba Canvio Basics in the locked oak cabinet in Ellis’s upstairs study.',
      8,
    ],
    [
      'Uncle Basil’s 2008 lentil-soup postcard: half a teaspoon of ground fenugreek for four portions.',
      7,
    ],
    [
      'Railway timetables from Grandad Felix in 2012; catalogue prefix RH-MID.',
      6,
    ],
    ['Binoculars: Opticron Discovery 8x42.', 0],
  ],
  changes: [
    {
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
      versions: [
        ['Morning drink: coffee from a copper three-cup moka pot.', 12],
        ['Morning drink: rooibos.', 8],
        ['Morning drink: roasted barley tea.', 2],
      ],
    },
    {
      versions: [
        ['Partner is Saffron; they keep separate homes.', 12],
        [
          'Saffron and Rowan ended their relationship in April but remain friends and still share allotment plot 26B at Willow Bank.',
          9,
        ],
      ],
    },
  ],
  retired: [['Commutes on the number 14 bus with a £64 monthly pass.', 11, 4]],
  pinned: [
    'Name is Rowan. Turned thirty in 2021.',
    'Retired greyhound Pip (racing name Silver Comet), home since 2019. Vet: Dr Celia Moss at Quarry Veterinary Practice.',
    'Mum, June, lives at 7 Orchard Close, Harrogate. Her wheelchair needs gates at least 84 cm wide and beds no higher than 60 cm.',
    'Saffron is allergic to hazelnuts, including hazelnut oil.',
  ],
}

const quill: MemorySeed = {
  facts: [
    [
      'Rowan is collections environment coordinator at Westfold Archive; manager Ada Finch.',
      3,
    ],
    [
      'Leads the spring condition survey of the map stores; the plan is due to Ada by the end of November.',
      0,
    ],
    [
      'Wants inbox summaries in two lines, most urgent first, and no summaries at weekends.',
      2,
    ],
    [
      'Store B’s humidity logger syncs its readings to the archive NAS each night.',
      2,
    ],
    ['Archive paper comes from Quarry Paper: acid-free A3, packs of 25.', 1],
  ],
  pinned: [
    'Rowan is collections environment coordinator at Westfold Archive; manager Ada Finch.',
  ],
}

const moss: MemorySeed = {
  facts: [
    [
      'Shares allotment plot 26B at Willow Bank with Saffron. The shed key is under the water butt.',
      9,
    ],
    [
      'Overwintering leeks, chard and purple sprouting broccoli on the plot.',
      1,
    ],
    [
      'June’s garden: Fenwick Gardens quoted £1,850 for 58 cm raised beds and an 88 cm gate.',
      4,
    ],
    [
      'June’s wheelchair needs gates at least 84 cm wide and beds no higher than 60 cm.',
      12,
    ],
    ['Saves borlotti bean seed each autumn in paper envelopes.', 6],
  ],
  pinned: [
    'June’s wheelchair needs gates at least 84 cm wide and beds no higher than 60 cm.',
  ],
}

const spool: MemorySeed = {
  facts: [
    [
      'The printer lives in the box room. A 0.4 mm hardened steel nozzle has been on it since September.',
      2,
    ],
    [
      'PETG goes in the filament dryer at 65 °C for four hours before printing.',
      3,
    ],
    [
      'The hallway coat hook has snapped twice in PLA; it’s being reprinted in PETG with four walls.',
      0,
    ],
    ['Print files live on the NAS under /prints.', 5],
  ],
}

/** Each Familiar's memory, by its name. */
export const memories: Record<string, MemorySeed> = {
  Juniper: juniper,
  Quill: quill,
  Moss: moss,
  Spool: spool,
}

const OWNER = { id: OWNER_ID, name: 'Rowan' }

// Calendar arithmetic on UTC dates, from today's day in the demo's zone.
const dayOf = (date: Date) => date.toISOString().slice(0, 10)
const todayAt = (at: number) =>
  new Date(`${localDay(at, DEMO_TIME_ZONE)}T00:00:00Z`)

/**
 * The owner's page as filing and consolidation would have left it, dated
 * back from now: each note true since the 10th of its month and said by the
 * owner. Seeded notes cite no messages; the demo has none to cite.
 */
function notesAsOf(seed: MemorySeed, now: Date, first: number) {
  const monthsAgo = (count: number) =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - count, 10))
  const notes: Note[] = []
  const save = (text: string, since: Date) => {
    const note: Note = {
      id: `n${first + notes.length}`,
      kind: 'fact',
      text,
      mentions: [],
      since: dayOf(since),
      quote: text,
      sources: [],
      saidBy: OWNER,
      origin: 'stated',
      saved: since.getTime(),
    }
    notes.push(note)
    return note
  }
  for (const { versions } of seed.changes ?? []) {
    let previous: Note | undefined
    for (const [text, ago] of versions) {
      const note = save(text, monthsAgo(ago))
      if (previous) {
        previous.until = note.since
        previous.retired = { reason: 'superseded', by: note.id, at: note.saved }
      }
      previous = note
    }
  }
  for (const [text, from, until] of seed.retired ?? []) {
    const note = save(text, monthsAgo(from))
    note.until = dayOf(monthsAgo(until))
    note.retired = { reason: 'obsolete', at: monthsAgo(until).getTime() }
  }
  for (const [text, ago] of seed.facts) {
    save(text, monthsAgo(ago))
  }
  return notes
}

/** Each Familiar with a memory seed, by ID, from the registry. */
async function seeded(tx: Parameters<typeof memoryOf>[0]) {
  const { familiars } = await tx.doc(Familiars)
  return Object.entries(familiars).flatMap(([id, { name }]) =>
    memories[name]
      ? [[Number(id) as FamiliarId, name, memories[name]] as const]
      : [],
  )
}

export const seedMemory = defineTool({
  name: 'seed_memory',
  description:
    'Demo only: fills each household Familiar’s memory of its owner with a sample year.',
  parameters: Type.Object({}),
  execute: (_args, api, context) =>
    api.commit(async (tx) => {
      for (const [id, name, seed] of await seeded(tx)) {
        const memory = await memoryOf(tx, id, name)
        const subject = `s${memory.next.subject++}`
        const notes = notesAsOf(seed, todayAt(api.now()), memory.next.note)
        memory.next.note += notes.length
        memory.subjects.push({
          id: subject,
          kind: 'person',
          name: OWNER.name,
          aliases: [],
          line: '',
          participant: { kind: 'person', id: OWNER.id },
          changed: api.now(),
          tidied: api.now(),
        })
        const page = await tx.doc(Pages, keyOf(id, subject), null)
        page.notes = notes
        page.profile = (seed.pinned ?? []).join(' ')
      }
      return { output: [{ type: 'text', text: 'Memory written.' }] }
    }, context),
})
