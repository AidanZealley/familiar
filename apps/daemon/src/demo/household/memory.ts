// What each of the household's Familiars remembers, as the nightly filing
// and profile pass would have left it after the story's earlier months
// (story.ts): a page per person and topic, notes that quote what was said
// to that Familiar, and journal lines. Each quote must be words from one
// message the Familiar was sent; the seed finds that message and reads who
// said it, where and when from it, as filing does.

import { Type, defineTool, type RoomId } from '@familiar-ai/core'
import {
  Familiars,
  Journal,
  keyOf,
  LIMITS,
  localDay,
  Memory,
  nextNight,
  Pages,
  saidBy,
  type FamiliarId,
  type JournalLine,
  type Note,
} from '@familiar-ai/core/diagnostics'
import type { Cursor, EntryId, Tx } from '@earendil-works/pi-durable'
import { OWNER_ID } from '../../serve.ts'
import { DEMO_TIME_ZONE } from '../scenarios/scenario.ts'
import { SAFFRON } from './story.ts'

type NoteSeed = {
  text: string
  /** Words from the message it rests on. */
  quote: string
  /** When it became true, `YYYY-MM-DD`, if before the message was sent. */
  since?: string
}

type PageSeed = {
  name: string
  kind: 'person' | 'topic'
  /** The workspace person this is, when they take part themselves. */
  person?: string
  line: string
  profile: string
  notes: NoteSeed[]
}

/** One Familiar's memory: its pages, then its journal, each line quoting its message. */
export type MemorySeed = {
  pages: PageSeed[]
  journal: { text: string; quote: string }[]
}

const juniper: MemorySeed = {
  pages: [
    {
      name: 'Rowan',
      kind: 'person',
      person: OWNER_ID,
      line: 'the person I look after',
      profile:
        'Rowan lives at Flat 5, Kelham Court, having just moved from Rivelin Street. Reminders go to Rowan’s watch, so keep them to one short line. Mornings start with roasted barley tea, not coffee. Pottery at Kiln House is on Tuesdays, at 7:30 pm from next week.',
      notes: [
        {
          text: 'Rowan lives at Flat 5, Kelham Court, having moved out of Rivelin Street.',
          quote: 'Rivelin Street is empty and we’re into Flat 5',
        },
        {
          text: 'Rowan drinks roasted barley tea in the mornings, not coffee.',
          quote: 'Roasted barley tea in the mornings from now on',
        },
        {
          text: 'Rowan reads reminders on a watch and wants them kept to one short line.',
          quote:
            'Keep reminders to one short line, please. I read them on my watch.',
        },
        {
          text: 'Rowan goes to pottery at Kiln House on Tuesdays, at 7:30 pm from next week.',
          quote: 'Tuesday pottery at Kiln House moves to 7:30 from next week',
        },
      ],
    },
    {
      name: 'Saffron',
      kind: 'person',
      person: SAFFRON.id,
      line: 'Rowan’s ex, still a close friend; shares plot 26B',
      profile:
        'Saffron is Rowan’s ex-partner; they broke up in April but are still good friends and share the allotment. Saffron is allergic to hazelnuts, including hazelnut oil.',
      notes: [
        {
          text: 'Saffron and Rowan broke up in April but are still good friends and share the allotment.',
          quote:
            'Saffron and I broke up in April, but we’re still good friends and we still share the allotment.',
        },
        {
          text: 'Saffron is allergic to hazelnuts, including hazelnut oil.',
          quote: 'she’s allergic to hazelnuts, and that includes hazelnut oil',
        },
      ],
    },
    {
      name: 'June',
      kind: 'person',
      line: 'Rowan’s mum, in Harrogate',
      profile:
        'June is Rowan’s mum and lives at 7 Orchard Close, Harrogate. She uses a wheelchair: anywhere she goes needs step-free access, gates at least 84 cm wide and beds no higher than 60 cm.',
      notes: [
        {
          text: 'June lives at 7 Orchard Close, Harrogate.',
          quote: 'She lives at 7 Orchard Close in Harrogate',
        },
        {
          text: 'June uses a wheelchair, so anywhere she goes needs step-free access.',
          quote:
            'she’s in a wheelchair now, so anywhere we go needs step-free access',
        },
        {
          text: 'June’s wheelchair needs garden gates at least 84 cm wide and beds no higher than 60 cm.',
          quote:
            'Mum says her chair needs a gate at least 84 cm wide, and beds no higher than 60 cm',
        },
      ],
    },
    {
      name: 'Ellis',
      kind: 'person',
      line: 'Rowan’s brother, in Derby',
      profile:
        'Ellis is Rowan’s brother and lives in Derby. He is the only person Rowan trusts to work on Bracken, Rowan’s bike.',
      notes: [
        {
          text: 'Ellis is Rowan’s brother and lives in Derby.',
          quote: 'drove it back up from Derby. My brother',
        },
        {
          text: 'Ellis is the only person Rowan trusts to work on Bracken, Rowan’s bike.',
          quote: 'My brother is the only person I trust with that bike.',
        },
      ],
    },
    {
      name: 'Dr Celia Moss',
      kind: 'person',
      line: 'Pip’s vet at Quarry Veterinary Practice',
      profile:
        'Dr Celia Moss is Pip’s vet at Quarry Veterinary Practice, which is open until 7 pm on weekdays.',
      notes: [
        {
          text: 'Dr Celia Moss is Pip’s vet at Quarry Veterinary Practice; the surgery is open until 7 pm on weekdays.',
          quote: 'Her surgery is open until 7 on weekdays.',
        },
      ],
    },
    {
      name: 'Noor Rahman',
      kind: 'person',
      line: 'building the Reed Shelter hide with Rowan',
      profile:
        'Noor Rahman is building the Reed Shelter birdwatching hide with Rowan.',
      notes: [
        {
          text: 'Noor Rahman is building the Reed Shelter hide with Rowan.',
          quote:
            'Noor Rahman and I worked out the roof for the Reed Shelter hide',
        },
      ],
    },
    {
      name: 'Pip',
      kind: 'topic',
      line: 'Rowan’s retired greyhound',
      profile:
        'Pip is Rowan’s retired greyhound, ten years old, who raced as Silver Comet and has lived with Rowan since 2019. He has a joint supplement every morning. His waterproof coat is a 66 cm from Fell Houndwear.',
      notes: [
        {
          text: 'Pip is Rowan’s retired greyhound; he raced as Silver Comet.',
          quote: 'Pip is my retired greyhound. He raced as Silver Comet',
          since: '2019-01-01',
        },
        {
          text: 'Pip’s waterproof coat is size 66 cm, from Fell Houndwear.',
          quote: 'came from Fell Houndwear: size 66 cm fits him perfectly',
        },
        {
          text: 'Pip has a joint supplement every morning, on his vet’s advice.',
          quote: 'Pip should have a joint supplement every morning from now on',
        },
        {
          text: 'Pip is ten years old.',
          quote: 'he’s in great shape for a ten-year-old',
        },
      ],
    },
    {
      name: 'Kelham Court',
      kind: 'topic',
      line: 'Rowan’s new flat',
      profile:
        'Flat 5, Kelham Court is Rowan’s new flat, at £940 a month. The black bin goes out on Tuesdays and the blue bin every other Thursday.',
      notes: [
        {
          text: 'The rent at Flat 5, Kelham Court is £940 a month.',
          quote: 'I got Flat 5 at Kelham Court! Rent’s £940 a month',
        },
        {
          text: 'At Kelham Court the black bin goes out on Tuesdays and the blue bin every other Thursday.',
          quote: 'black bin on Tuesdays, blue every other Thursday',
        },
      ],
    },
    {
      name: 'Plot 26B',
      kind: 'topic',
      line: 'the allotment Rowan shares with Saffron',
      profile: 'The rent for plot 26B is £48, due on 1 December.',
      notes: [
        {
          text: 'The rent for plot 26B is £48, due on 1 December.',
          quote: 'the plot rent is £48, due on 1 December',
        },
      ],
    },
    {
      name: 'June’s garden',
      kind: 'topic',
      line: 'new beds and a wider gate at Mum’s',
      profile:
        'Fenwick Gardens are building June’s new garden: 58 cm beds and an 88 cm gate for £1,850, which clear her 60 cm and 84 cm limits.',
      notes: [
        {
          text: 'Rowan chose Fenwick Gardens for June’s garden: £1,850 for 58 cm beds and an 88 cm gate.',
          quote:
            'we’re going with Fenwick Gardens: £1,850 for 58 cm beds and an 88 cm gate',
        },
      ],
    },
    {
      name: 'Reed Shelter',
      kind: 'topic',
      line: 'the birdwatching hide, on hold',
      profile:
        'Reed Shelter is the hide Rowan and Noor are building. It is on hold until the landowner gives permission. Each roof panel must weigh 8 kg or less, to go up the ladder.',
      notes: [
        {
          text: 'Each Reed Shelter roof panel must weigh 8 kg or less, so it can be lifted up the ladder.',
          quote:
            'each panel has to weigh 8 kg or less so we can lift it up the ladder',
        },
        {
          text: 'Reed Shelter, the hide Rowan and Noor are building, is on hold until the landowner gives permission.',
          quote:
            'the landowner hasn’t given Noor and me permission to build the hide yet',
        },
      ],
    },
    {
      name: 'Canal Voices',
      kind: 'topic',
      line: 'Rowan’s sound project',
      profile:
        'Canal Voices is Rowan’s sound project of lock gates and boat engines recorded at dawn. All six tracks are recorded; there is no release date yet.',
      notes: [
        {
          text: 'Canal Voices has all six tracks recorded, of lock gates and boat engines at dawn, but no release date.',
          quote:
            'all six tracks are recorded, lock gates and boat engines at dawn, but there’s no release date yet',
        },
      ],
    },
  ],
  journal: [
    {
      text: 'Pip’s new waterproof coat arrived from Fell Houndwear.',
      quote: 'Pip’s new waterproof coat came from Fell Houndwear',
    },
    {
      text: 'Rowan said June was coming to stay for the weekend.',
      quote: 'Mum’s coming to stay this weekend.',
    },
    {
      text: 'Rowan gave up coffee for roasted barley tea.',
      quote: 'I’ve gone off coffee.',
    },
    {
      text: 'Ellis fixed the gears on Bracken and brought it back from Derby.',
      quote: 'Ellis fixed the gears on Bracken today',
    },
    {
      text: 'Rowan got Flat 5 at Kelham Court.',
      quote: 'Big news: I got Flat 5 at Kelham Court!',
    },
    {
      text: 'Saffron was invited for dinner on Friday.',
      quote: 'Saffron’s coming for dinner on Friday.',
    },
    {
      text: 'Reed Shelter went on hold, waiting for the landowner.',
      quote: 'Reed Shelter is on hold',
    },
    {
      text: 'Rowan chose Fenwick Gardens for June’s garden.',
      quote: 'we’re going with Fenwick Gardens',
    },
    {
      text: 'Rowan finished recording all six Canal Voices tracks.',
      quote: 'Canal Voices update: all six tracks are recorded',
    },
    {
      text: 'Rowan moved out of Rivelin Street into Flat 5, Kelham Court.',
      quote: 'moving day!',
    },
    {
      text: 'Pip had his teeth checked at Quarry Veterinary Practice.',
      quote: 'Pip had his teeth checked at Quarry today',
    },
    {
      text: 'Tuesday pottery moved to 7:30 pm.',
      quote: 'moves to 7:30 from next week',
    },
  ],
}

const quill: MemorySeed = {
  pages: [
    {
      name: 'Rowan',
      kind: 'person',
      person: OWNER_ID,
      line: 'collections environment coordinator at Westfold Archive',
      profile:
        'Rowan is collections environment coordinator at Westfold Archive. Inbox summaries are two lines, most urgent first, and never at weekends.',
      notes: [
        {
          text: 'Rowan is collections environment coordinator at Westfold Archive.',
          quote:
            'Started at Westfold Archive today, as collections environment coordinator.',
        },
        {
          text: 'Rowan wants inbox summaries in two lines, most urgent first, and none at weekends.',
          quote: 'two lines, most urgent first, and nothing at weekends',
        },
      ],
    },
    {
      name: 'Ada Finch',
      kind: 'person',
      line: 'Rowan’s manager at Westfold Archive',
      profile: 'Ada Finch is Rowan’s manager at Westfold Archive.',
      notes: [
        {
          text: 'Ada Finch is Rowan’s manager at Westfold Archive.',
          quote: 'My manager is Ada Finch.',
        },
      ],
    },
    {
      name: 'Condition survey',
      kind: 'topic',
      line: 'Rowan’s survey of the archive’s stores',
      profile:
        'Rowan is leading the condition survey for Ada: the map stores first, then the photographic store.',
      notes: [
        {
          text: 'The condition survey covers the map stores first, then the photographic store.',
          quote:
            'lead the condition survey: the map stores first, then the photographic store',
        },
      ],
    },
    {
      name: 'Store B',
      kind: 'topic',
      line: 'the store with the humidity logger',
      profile:
        'Store B is kept between 45 and 55% relative humidity. Its logger syncs readings to the archive NAS every night.',
      notes: [
        {
          text: 'Store B’s humidity logger syncs its readings to the archive NAS every night.',
          quote:
            'Store B’s humidity logger now syncs its readings to the archive NAS every night.',
        },
        {
          text: 'Ada wants Store B kept between 45 and 55% relative humidity.',
          quote: 'Ada wants Store B kept between 45 and 55% relative humidity.',
        },
      ],
    },
  ],
  journal: [
    {
      text: 'Rowan started at Westfold Archive.',
      quote: 'Started at Westfold Archive today',
    },
    {
      text: 'Ada asked Rowan to lead the condition survey.',
      quote: 'Ada has asked me to lead the condition survey',
    },
  ],
}

const moss: MemorySeed = {
  pages: [
    {
      name: 'Rowan',
      kind: 'person',
      person: OWNER_ID,
      line: 'shares plot 26B with Saffron',
      profile:
        'Warn Rowan whenever it’s forecast to go below zero at Willow Bank. Rowan saves borlotti seed each year, in paper envelopes.',
      notes: [
        {
          text: 'Rowan wants a warning whenever it’s forecast to go below zero at Willow Bank.',
          quote: 'Warn me whenever it’s due to go below zero at Willow Bank.',
        },
        {
          text: 'Rowan saves borlotti bean seed each year, in paper envelopes.',
          quote: 'I’m saving borlotti seed again, in paper envelopes.',
        },
      ],
    },
    {
      name: 'Saffron',
      kind: 'person',
      person: SAFFRON.id,
      line: 'shares plot 26B with Rowan',
      profile: 'Saffron shares plot 26B with Rowan.',
      notes: [
        {
          text: 'Saffron shares plot 26B with Rowan.',
          quote: 'Rowan and I still share plot 26B',
        },
      ],
    },
    {
      name: 'June',
      kind: 'person',
      line: 'Rowan’s mum, who uses a wheelchair',
      profile:
        'June is Rowan’s mum. Her wheelchair needs gates at least 84 cm wide and beds no higher than 60 cm.',
      notes: [
        {
          text: 'June’s wheelchair needs gates at least 84 cm wide and beds no higher than 60 cm.',
          quote:
            'her chair needs a gate at least 84 cm wide, and beds no higher than 60 cm',
        },
      ],
    },
    {
      name: 'Plot 26B',
      kind: 'topic',
      line: 'the allotment at Willow Bank',
      profile:
        'The shed key is under the water butt. Leeks, chard and purple sprouting broccoli are in for winter, and broad beans are sown in the end bed, which mustn’t be dug until spring.',
      notes: [
        {
          text: 'The plot 26B shed key is kept under the water butt.',
          quote: 'The shed key lives under the water butt.',
        },
        {
          text: 'Leeks, chard and purple sprouting broccoli are growing on plot 26B over winter.',
          quote:
            'Leeks, chard and purple sprouting broccoli are in for the winter.',
        },
        {
          text: 'Broad beans are sown in the end bed, which mustn’t be dug until spring.',
          quote:
            'I’ve sown broad beans in the end bed, so please nobody dig there until spring.',
        },
      ],
    },
    {
      name: 'June’s garden',
      kind: 'topic',
      line: 'new beds and a wider gate at Mum’s',
      profile:
        'Fenwick Gardens are building June’s new garden: 58 cm raised beds and an 88 cm gate for £1,850.',
      notes: [
        {
          text: 'Fenwick Gardens are building June’s garden: 58 cm beds and an 88 cm gate, for £1,850.',
          quote: '£1,850 for 58 cm beds and an 88 cm gate',
        },
      ],
    },
  ],
  journal: [
    {
      text: 'Saffron joined the Allotment room.',
      quote: 'Hi all, Saffron here.',
    },
    {
      text: 'Rowan chose Fenwick Gardens for June’s garden.',
      quote: 'we’re going with Fenwick Gardens',
    },
    {
      text: 'Saffron sowed broad beans in the end bed.',
      quote: 'I’ve sown broad beans in the end bed',
    },
  ],
}

const spool: MemorySeed = {
  pages: [
    {
      name: 'Rowan',
      kind: 'person',
      person: OWNER_ID,
      line: 'owns the printer in the box room',
      profile:
        'Rowan keeps the printer in the box room, next to the bedroom, so noisy prints run in the daytime.',
      notes: [
        {
          text: 'Rowan wants noisy prints run in the daytime, as the box room is next to the bedroom.',
          quote: 'next to my bedroom, so keep anything noisy to the daytime',
        },
      ],
    },
    {
      name: 'The printer',
      kind: 'topic',
      line: 'in the box room',
      profile:
        'The printer is in the box room, with a 0.4 mm hardened steel nozzle. Print files are on the NAS under /prints. PETG is dried at 65 °C for four hours before printing.',
      notes: [
        {
          text: 'The printer is in the box room.',
          quote: 'The printer lives in the box room',
        },
        {
          text: 'The printer has a 0.4 mm hardened steel nozzle.',
          quote: 'a 0.4 mm hardened steel one',
        },
        {
          text: 'Print files are kept on the NAS under /prints.',
          quote: 'Print files are on the NAS under /prints from now on.',
        },
        {
          text: 'PETG is dried at 65 °C for four hours before printing.',
          quote: 'PETG needs 65 °C for four hours before you print with it',
        },
      ],
    },
    {
      name: 'Hallway coat hook',
      kind: 'topic',
      line: 'the hook that keeps snapping',
      profile: 'The hallway coat hook was printed in PLA and snapped.',
      notes: [
        {
          text: 'The hallway coat hook, printed in PLA, snapped.',
          quote: 'the hallway coat hook you printed in PLA has snapped',
        },
      ],
    },
  ],
  journal: [
    {
      text: 'Rowan fitted a hardened steel nozzle.',
      quote: 'Swapped the brass nozzle for a 0.4 mm hardened steel one today.',
    },
    {
      text: 'The PLA hallway coat hook snapped.',
      quote: 'the hallway coat hook you printed in PLA has snapped',
    },
  ],
}

/** Each Familiar's memory, by its name. */
export const memories: Record<string, MemorySeed> = {
  Juniper: juniper,
  Quill: quill,
  Moss: moss,
  Spool: spool,
}

/** A person's message in a Familiar's chat: what a quote can rest on. */
type Source = {
  entry: EntryId
  text: string
  author: { id: string; name: string }
  room?: RoomId
  at: number
}

async function sourcesOf(tx: Tx, familiar: FamiliarId) {
  const sources: Source[] = []
  let cursor: Cursor | undefined
  do {
    const page = await tx.scanEntries(
      { conversationId: familiar, order: 'ascending' },
      200,
      cursor,
    )
    for (const entry of page.items) {
      const said = saidBy(entry)
      if (said?.role === 'person') {
        const { room } = (entry.data ?? {}) as { room?: RoomId }
        sources.push({ entry: entry.id, ...said, room })
      }
    }
    cursor = page.next
  } while (cursor)
  return sources
}

const within = (text: string, limit: number) => {
  if (text.length > limit) {
    throw new Error(`Over ${limit} characters: ${text}`)
  }
  return text
}

/**
 * Replaces `familiar`'s memory with `seed`. Throws for a quote that isn't
 * in exactly one of the person messages it was sent.
 */
async function writeMemory(tx: Tx, familiar: FamiliarId, seed: MemorySeed) {
  const sources = await sourcesOf(tx, familiar)
  const sourceOf = (quote: string) => {
    const found = sources.filter(({ text }) => text.includes(quote))
    if (found.length !== 1) {
      throw new Error(`“${quote}” is in ${found.length} messages, not one.`)
    }
    return found[0]
  }
  const said = (source: Source) => ({
    saidBy: source.author,
    ...(source.room !== undefined && { room: source.room }),
  })
  const day = (source: Source) => localDay(source.at, DEMO_TIME_ZONE)

  const memory = await tx.doc(Memory, String(familiar), null)
  let notes = 0
  memory.subjects = []
  for (const [index, page] of seed.pages.entries()) {
    const id = `s${index + 1}`
    const written: Note[] = page.notes.map(({ text, quote, since }) => {
      const source = sourceOf(quote)
      return {
        id: `n${++notes}`,
        text: within(text, LIMITS.note),
        since: since ?? day(source),
        quote: within(quote, LIMITS.quote),
        source: source.entry,
        ...said(source),
      }
    })
    // Changed the night after its newest note was said, and profiled then.
    const newest = Math.max(
      ...page.notes.map(({ quote }) => sourceOf(quote).at),
    )
    const changed = nextNight(newest, DEMO_TIME_ZONE)
    memory.subjects.push({
      id,
      kind: page.kind,
      name: page.name,
      ...(page.person && { person: page.person }),
      line: within(page.line, LIMITS.subjectLine),
      changed,
      profiled: changed,
    })
    const doc = await tx.doc(Pages, keyOf(familiar, id), null)
    doc.notes = written
    doc.profile = within(page.profile, LIMITS.profile)
  }
  memory.next = { subject: seed.pages.length + 1, note: notes + 1 }

  const months = new Map<string, JournalLine[]>()
  for (const { text, quote } of seed.journal) {
    const source = sourceOf(quote)
    const on = day(source)
    const lines = months.get(on.slice(0, 7)) ?? []
    lines.push({
      exchange: source.entry,
      on,
      text: within(text, LIMITS.line),
      quote,
      ...said(source),
    })
    months.set(on.slice(0, 7), lines)
  }
  memory.months = [...months.keys()].sort()
  for (const [month, lines] of months) {
    const doc = await tx.doc(Journal, keyOf(familiar, month), null)
    doc.lines = lines.sort((a, b) => a.exchange - b.exchange)
  }
}

export const seedMemory = defineTool({
  name: 'seed_memory',
  description:
    'Demo only: fills each household Familiar’s memory with what its earlier months would have left.',
  parameters: Type.Object({}),
  execute: (_args, api, context) =>
    api.commit(async (tx) => {
      const { familiars } = await tx.doc(Familiars)
      for (const [id, { name }] of Object.entries(familiars)) {
        if (memories[name]) {
          await writeMemory(tx, Number(id) as FamiliarId, memories[name])
        }
      }
      return { output: [{ type: 'text', text: 'Memory written.' }] }
    }, context),
})
