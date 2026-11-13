import type { EntryId } from '@earendil-works/pi-durable'
import { expect, test } from 'vitest'
import { timeAt, TEST_ZONE } from '../testing.ts'
import { applyFiling, type FilingStore } from './filing/apply.ts'
import { meetPeople, type BatchMessage } from './filing/batch.ts'
import { repairPage } from './filing/consolidate.ts'
import type { FileArgs } from './filing/tools.ts'
import { renderSection } from './section.ts'
import {
  standingOf,
  type JournalState,
  type MemoryState,
  type Note,
  type PageState,
} from './store.ts'

// The rules that make memory trustworthy, on plain data: what filing keeps,
// what consolidation repairs, and what the prompt always shows.

const aidan = { id: 'aidan', name: 'Aidan' }
const maya = { id: 'maya', name: 'Maya' }
const now = timeAt('2026-03-06 12:00')

const message = (
  m: number,
  text: string,
  extra: Partial<BatchMessage> = {},
): BatchMessage => ({
  m,
  entry: (100 + m) as EntryId,
  author: aidan,
  at: timeAt('2026-03-06 09:00'),
  text,
  shown: [],
  asked: false,
  ...extra,
})

/** A Familiar's memory as plain maps, as a commit's documents would be. */
function memory(seed: Partial<MemoryState> = {}) {
  const state: MemoryState = {
    subjects: [
      {
        id: 's1',
        kind: 'self',
        name: 'Familiar',
        aliases: [],
        line: 'you',
        changed: 0,
        tidied: 0,
      },
    ],
    next: { subject: 2, note: 1 },
    months: [],
    forgotten: [],
    ...seed,
  }
  const pages = new Map<string, PageState>()
  const months = new Map<string, JournalState>()
  const store: FilingStore = {
    memory: state,
    page: async (subject) => {
      if (!pages.has(subject)) {
        pages.set(subject, { profile: '', notes: [] })
      }
      return pages.get(subject)!
    },
    month: async (month) => {
      if (!months.has(month)) {
        months.set(month, { lines: [] })
      }
      return months.get(month)!
    },
  }
  // As a pass does: the batch's people have pages before the call.
  const file = (messages: BatchMessage[], args: FileArgs) => {
    meetPeople(state, { names: {} }, messages, now)
    return applyFiling(
      store,
      messages,
      state.subjects.map((s) => s.id),
      args,
      {
        now,
        timeZone: TEST_ZONE,
      },
    )
  }
  const subject = (name: string) =>
    state.subjects.find((subject) => subject.name === name)!
  const notesOf = (name: string) => pages.get(subject(name).id)?.notes ?? []
  return { state, pages, months, file, subject, notesOf }
}

test('an operation is kept only if its quote is in a person message of the batch, and who said it comes from that message', async () => {
  const mind = memory()
  const said = message(1, "Theo's allergic to nuts, so no satay.", {
    author: maya,
    room: 7 as never,
    shown: [{ author: aidan, text: 'Theo starts school in September' }],
  })
  const result = await mind.file([said, message(2, 'What time is it?')], {
    subjects: [
      { ref: 'theo', kind: 'person', name: 'Theo', line: "Maya's son" },
    ],
    notes: [
      // Quoted from Maya's message, on Theo's page.
      {
        subject: 'theo',
        kind: 'fact',
        text: 'Theo is allergic to nuts.',
        m: [1],
        quote: "theo's ALLERGIC   to nuts",
      },
      // Aidan's words, shown with Maya's message: said by Aidan.
      {
        subject: 'theo',
        kind: 'plan',
        text: 'Theo starts school in September.',
        m: [1],
        quote: 'starts school in September',
      },
      // Words nobody said.
      {
        subject: 'theo',
        kind: 'fact',
        text: 'Theo likes football.',
        m: [1],
        quote: 'loves football',
      },
      // A real quote from a message it doesn't cite: that message is its source.
      {
        subject: 'theo',
        kind: 'fact',
        text: 'Theo asked the time.',
        m: [1],
        quote: 'What time is it',
      },
      // No quote at all.
      {
        subject: 'theo',
        kind: 'fact',
        text: 'Theo is tall.',
        m: [1],
        quote: '',
      },
    ],
  })

  expect(result.dropped).toHaveLength(2)
  const [allergy, school, time] = mind.notesOf('Theo')
  expect(allergy).toMatchObject({
    text: 'Theo is allergic to nuts.',
    saidBy: maya,
    room: 7,
    sources: [101],
    since: '2026-03-06',
    origin: 'inferred',
  })
  expect(school.saidBy).toEqual(aidan)
  expect(time).toMatchObject({ sources: [102], saidBy: aidan })
  expect(mind.notesOf('Theo')).toHaveLength(3)
  // People who take part get pages by code, linked by ID.
  expect(mind.subject('Maya').participant).toEqual({
    kind: 'person',
    id: 'maya',
  })
  expect(mind.subject('Aidan').participant).toEqual({
    kind: 'person',
    id: 'aidan',
  })
})

test('a repeat confirms, a change replaces, a contradiction retires, and standing follows the evidence', async () => {
  const mind = memory()
  await mind.file([message(1, "I'm vegetarian these days.")], {
    notes: [
      {
        subject: 'Aidan',
        kind: 'preference',
        text: 'Aidan is vegetarian.',
        m: [1],
        quote: "I'm vegetarian",
      },
    ],
  })
  const [vegetarian] = mind.notesOf('Aidan')
  expect(standingOf(vegetarian)).toBe('tentative')

  // The same words again, from a later message, confirm it.
  await mind.file([message(2, 'Still vegetarian, yes.')], {
    notes: [
      {
        subject: 'Aidan',
        kind: 'preference',
        text: 'Aidan is  vegetarian',
        m: [2],
        quote: 'still vegetarian',
      },
    ],
  })
  expect(mind.notesOf('Aidan')).toHaveLength(1)
  expect(vegetarian.sources).toEqual([101, 102])
  expect(standingOf(vegetarian)).toBe('confirmed')

  // Asked to remember: stated.
  await mind.file(
    [message(3, 'Remember I moved to York in February.', { asked: true })],
    {
      notes: [
        {
          subject: 'Aidan',
          kind: 'fact',
          text: 'Aidan lives in York.',
          since: '2026-02-01',
          m: [3],
          quote: 'moved to York',
        },
      ],
    },
  )
  const york = mind.notesOf('Aidan')[1]
  expect(standingOf(york)).toBe('stated')

  // A change replaces; a contradiction retires.
  await mind.file(
    [message(4, 'Actually I moved to Leeds last week. And I eat fish now.')],
    {
      notes: [
        {
          subject: 'Aidan',
          kind: 'fact',
          text: 'Aidan lives in Leeds.',
          m: [4],
          quote: 'moved to Leeds',
          replaces: [york.id],
        },
      ],
      retire: [
        {
          note: vegetarian.id,
          reason: 'contradicted',
          m: [4],
          quote: 'I eat fish now',
        },
      ],
    },
  )
  const leeds = mind.notesOf('Aidan')[2]
  expect(york.retired).toMatchObject({ reason: 'superseded', by: leeds.id })
  expect(york.until).toBe('2026-03-06')
  expect(vegetarian.retired).toMatchObject({ reason: 'contradicted' })

  // Retired notes can't be confirmed or replaced again.
  const late = await mind.file([message(5, 'York was lovely.')], {
    confirm: [{ note: york.id, m: [5], quote: 'York was lovely' }],
  })
  expect(late.dropped).toEqual([
    { what: `confirm ${york.id}`, why: 'no such current note' },
  ])
})

test('nothing is written from a forgotten message, and lessons only go on the Familiar’s own page', async () => {
  const mind = memory({ forgotten: [101 as EntryId] })
  const result = await mind.file(
    [
      message(1, 'My PIN is 4821.'),
      message(2, 'Please use dates like 13 Nov, not 11/13.'),
    ],
    {
      notes: [
        {
          subject: 'Aidan',
          kind: 'fact',
          text: "Aidan's PIN is 4821.",
          m: [1],
          quote: 'PIN is 4821',
        },
      ],
      journal: [
        {
          m: [1],
          on: '2026-03-06',
          text: 'Aidan shared his PIN.',
          quote: 'My PIN',
        },
      ],
    },
  )
  expect(result.dropped.map((each) => each.why)).toEqual([
    'its message was forgotten',
    'its message was forgotten',
  ])
  expect(mind.months.size).toBe(0)

  await mind.file([message(2, 'Please use dates like 13 Nov, not 11/13.')], {
    notes: [
      {
        subject: 'Aidan',
        kind: 'lesson',
        text: 'Write dates like 13 Nov.',
        m: [2],
        quote: 'dates like 13 Nov',
      },
    ],
  })
  expect(mind.pages.get('s1')!.notes.map((note) => note.text)).toEqual([
    'Write dates like 13 Nov.',
  ])
})

test('a journal line is dated from what was said, in the month of its message', async () => {
  const mind = memory()
  await mind.file(
    [message(1, 'I ran the Leeds 10k yesterday in 52 minutes!')],
    {
      journal: [
        {
          m: [1],
          on: '2026-03-05',
          text: 'Aidan ran the Leeds 10k in 52 minutes.',
          subjects: ['Aidan'],
          quote: 'Leeds 10k yesterday',
        },
        {
          m: [1],
          on: 'yesterday',
          text: 'Aidan was pleased with his time.',
          quote: '52 minutes',
        },
      ],
    },
  )
  expect(mind.months.get('2026-03')!.lines).toMatchObject([
    {
      exchange: 101,
      on: '2026-03-05',
      subjects: [mind.subject('Aidan').id],
      saidBy: aidan,
    },
    // An unreadable day falls back to the message's own.
    { exchange: 101, on: '2026-03-06' },
  ])
})

const note = (id: string, extra: Partial<Note>): Note => ({
  id,
  kind: 'fact',
  text: id,
  mentions: [],
  since: '2026-01-01',
  quote: 'q',
  sources: [1 as EntryId],
  saidBy: aidan,
  origin: 'inferred',
  saved: now,
  ...extra,
})

test('repair retires what has passed and plans nobody repeated, and merges notes that say the same', () => {
  const DAY = 24 * 60 * 60 * 1000
  const page: PageState = {
    profile: '',
    notes: [
      note('n1', { kind: 'plan', until: '2026-03-01' }),
      note('n2', { kind: 'plan', saved: now - 61 * DAY }),
      note('n3', {
        kind: 'plan',
        saved: now - 61 * DAY,
        sources: [1, 2] as EntryId[],
      }),
      note('n4', { saved: now - 61 * DAY, origin: 'stated' }),
      note('n5', { text: 'Likes tea' }),
      note('n6', { text: 'likes  tea.', sources: [3 as EntryId] }),
      note('n7', { kind: 'plan', until: '2026-04-01', saved: now - 61 * DAY }),
      // Said once long ago, and still true: only plans go stale.
      note('n8', { saved: now - 61 * DAY }),
    ],
  }
  expect(repairPage(page, '2026-03-06', now)).toBe(true)
  const state = Object.fromEntries(
    page.notes.map((each) => [each.id, each.retired?.reason ?? 'current']),
  )
  expect(state).toEqual({
    n1: 'expired',
    n2: 'stale',
    n3: 'current',
    n4: 'current',
    n5: 'current',
    n6: 'duplicate',
    n7: 'current',
    n8: 'current',
  })
  expect(page.notes[4].sources).toEqual([1, 3])
  expect(repairPage(page, '2026-03-06', now)).toBe(false)
})

test('the prompt section holds every profile of who takes part, and the roster only within its budget', () => {
  const subjects = [
    {
      id: 's1',
      kind: 'self' as const,
      name: 'Familiar',
      aliases: [],
      line: 'you',
      changed: 0,
    },
    {
      id: 's2',
      kind: 'person' as const,
      name: 'Aidan',
      aliases: [],
      line: '',
      participant: { kind: 'person' as const, id: 'aidan' },
      changed: 5,
    },
    ...Array.from({ length: 50 }, (_, index) => ({
      id: `s${index + 3}`,
      kind: 'topic' as const,
      name: `Topic ${index}`,
      aliases: [],
      line: 'something that came up once and might again',
      changed: index,
    })),
  ]
  const profiles: Record<string, string> = {
    s1: 'Writes dates like 13 Nov.',
    s2: 'Aidan lives in Leeds with Maya.',
  }
  const section = renderSection(
    {
      subjects: () => subjects,
      page: (id) =>
        profiles[id] ? { profile: profiles[id], notes: [] } : undefined,
    },
    500,
  )
  expect(section).toContain(
    'How you have learned to work:\nWrites dates like 13 Nov.',
  )
  expect(section).toContain('Aidan (s2): Aidan lives in Leeds with Maya.')
  // Most recently changed first, cut at the budget, with how many more.
  const roster = section.split('most recent first:\n')[1].split('\n')
  expect(roster[0]).toBe(
    'Topic 49 (s52): something that came up once and might again',
  )
  expect(roster.slice(0, -1).join('\n').length).toBeLessThanOrEqual(500)
  expect(roster.at(-1)).toMatch(/^…and \d+ more, which recall finds\.$/)
})
