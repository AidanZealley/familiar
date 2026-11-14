import type { TranscriptContext } from '@earendil-works/pi-ai'
import type { EntryId } from '@earendil-works/pi-durable'
import {
  fauxAssistantMessage,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux'
import { expect, test, vi } from 'vitest'
import { scriptedModels } from '../models/scripted.ts'
import { fakeClock, testHost, TEST_ZONE, timeAt } from '../testing.ts'
import { applyFiling, type FileArgs } from './filing/apply.ts'
import type { BatchMessage } from './filing/batch.ts'
import type { JournalState, MemoryState, PageState } from './store.ts'
import { createMemoryIndex } from './view.ts'

const said = (context: TranscriptContext) => JSON.stringify(context.messages)

test('messages are filed at night in one call, then each changed page gets its profile; forgetting removes a note and its profile', async () => {
  const clock = fakeClock(timeAt('2026-03-06 09:00'))
  const filing: string[] = []
  const host = await testHost({
    timeZone: TEST_ZONE,
    now: clock.now,
    setTimer: clock.setTimer,
    models: scriptedModels((request) => {
      const input = said(request.context)
      if (input.includes('You keep the memory of')) {
        filing.push(input)
        const args: FileArgs = {
          subjects: [{ name: 'Grace', kind: 'person', line: "aidan's sister" }],
          notes: [
            {
              subject: 'Grace',
              text: 'Grace lives in Leeds.',
              m: [1],
              quote: 'Grace just moved to Leeds',
            },
            // Not in any message: thrown away.
            {
              subject: 'Grace',
              text: 'Grace is a nurse.',
              m: [1],
              quote: 'she nurses',
            },
          ],
        }
        return fauxAssistantMessage([fauxToolCall('file', args)], {
          stopReason: 'toolUse',
        })
      }
      if (input.includes('You write the profile')) {
        return fauxAssistantMessage('Lives in Leeds.')
      }
      return fauxAssistantMessage('Noted.')
    }),
  })
  const idle = async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
    await vi.waitFor(() => expect(host.workspace().wake().active).toBe(false))
  }
  const memory = () => host.familiar().memory
  const subjects = async () => {
    const watch = await memory().watch()
    await watch.stop()
    return watch.value!.subjects
  }

  await host.say('My sister Grace just moved to Leeds.')
  await idle()
  expect(filing).toHaveLength(0)

  clock.advanceTo(timeAt('2026-03-07 04:00'))
  await idle()
  expect(filing).toHaveLength(1)
  expect(filing[0]).toContain('[m1] aidan, in a DM, Fri 2026-03-06 09:00:')
  expect(filing[0]).toContain('(Familiar: its reply, context only) Noted.')

  const grace = (await subjects()).find((subject) => subject.name === 'Grace')!
  const page = await memory().page(grace.id)
  expect(page).toMatchObject({
    profile: 'Lives in Leeds.',
    notes: [{ text: 'Grace lives in Leeds.', saidBy: { id: 'aidan' } }],
  })
  // Aidan's page was made by code; with no notes it needs no call.
  expect(await memory().section()).toContain('Grace (s2): aidan')

  await memory().forget(page.notes[0].id)
  expect(await memory().page(grace.id)).toEqual({ profile: '', notes: [] })
  await expect(memory().forget(page.notes[0].id)).rejects.toThrow('No note')
})

const message = (
  m: number,
  text: string,
  shown: BatchMessage['shown'] = [],
): BatchMessage => ({
  m,
  entry: (m * 10) as EntryId,
  author: { id: 'maya', name: 'Maya' },
  at: timeAt('2026-03-06 09:00'),
  text,
  shown,
})

test('applying keeps only what a quote supports, says who said it from the message, and replaces notes', async () => {
  const memory: MemoryState = {
    subjects: [
      {
        id: 's1',
        kind: 'person',
        name: 'Maya',
        person: 'maya',
        line: '',
        changed: 0,
        profiled: 0,
      },
    ],
    next: { subject: 2, note: 2 },
    months: [],
  }
  const pages = new Map<string, PageState>([
    [
      's1',
      {
        profile: '',
        notes: [
          {
            id: 'n1',
            text: 'Maya is vegetarian.',
            since: '2025-01-01',
            quote: 'vegetarian',
            source: 1 as EntryId,
            saidBy: { id: 'maya', name: 'Maya' },
            saved: 0,
          },
        ],
      },
    ],
  ])
  const months = new Map<string, JournalState>()
  const store = {
    memory,
    page: async (id: string) =>
      pages.get(id) ?? pages.set(id, { profile: '', notes: [] }).get(id)!,
    month: async (month: string) =>
      months.get(month) ?? months.set(month, { lines: [] }).get(month)!,
  }
  await applyFiling(
    store,
    [
      message(1, 'I eat fish again now.'),
      message(2, 'What do you think of this?', [
        {
          author: { id: 'theo', name: 'Theo' },
          text: 'I ran the Leeds 10k yesterday',
        },
      ]),
    ],
    ['s1'],
    {
      subjects: [
        { name: 'Theo', kind: 'person', line: '' },
        { name: 'Nobody', kind: 'topic', line: '' },
      ],
      notes: [
        {
          subject: 's1',
          text: 'Maya eats fish.',
          m: [1],
          quote: 'eat fish again',
          replaces: ['n1'],
        },
        {
          subject: 's1',
          text: 'Maya likes jazz.',
          m: [1],
          quote: 'I love jazz',
        },
      ],
      journal: [
        {
          on: '2026-03-05',
          text: 'Theo ran the Leeds 10k.',
          m: [1],
          quote: 'Leeds 10k',
        },
      ],
    },
    { now: 5, timeZone: TEST_ZONE },
  )
  expect(pages.get('s1')!.notes.map((note) => note.text)).toEqual([
    'Maya eats fish.',
  ])
  // A subject is made only when a note lands on it.
  expect(memory.subjects.map((subject) => subject.name)).toEqual(['Maya'])
  // Found in the room line shown with message 2, so it is Theo's words.
  expect(months.get('2026-03')!.lines).toMatchObject([
    { exchange: 20, on: '2026-03-05', saidBy: { id: 'theo' } },
  ])
})

test('search finds an exchange by its journal lines and their days, and a note by its subject', () => {
  const index = createMemoryIndex(TEST_ZONE)
  const at = timeAt('2026-03-06 09:00')
  index.addExchange({
    id: 'x1',
    at,
    text: 'Had a great time at the weekend.',
    last: 2 as EntryId,
  })
  index.addExchange({
    id: 'x3',
    at,
    text: 'Lunch was fine.',
    last: 4 as EntryId,
  })
  index.setMonth('2026-03', {
    lines: [
      {
        exchange: 1 as EntryId,
        on: '2026-02-14',
        text: 'Aidan went climbing in the Peak District.',
        quote: 'great time',
        saidBy: { id: 'aidan', name: 'aidan' },
      },
    ],
  })
  index.setMemory({
    subjects: [
      {
        id: 's1',
        kind: 'person',
        name: 'Grace',
        line: '',
        changed: 0,
        profiled: 0,
      },
    ],
    next: { subject: 2, note: 2 },
    months: ['2026-03'],
  })
  index.setPage('s1', {
    profile: '',
    notes: [
      {
        id: 'n1',
        text: 'Lives in Leeds.',
        since: '2026-03-06',
        quote: 'Leeds',
        source: 3 as EntryId,
        saidBy: { id: 'aidan', name: 'aidan' },
        saved: 0,
      },
    ],
  })
  const ids = (query: string, ranges?: { start: string; end: string }[]) =>
    index
      .search(query, { now: at, ranges })
      .map((hit) => (hit.kind === 'exchange' ? hit.exchange.id : hit.note.id))

  expect(ids('climbing')).toEqual(['x1'])
  expect(ids('', [{ start: '2026-02-14', end: '2026-02-14' }])).toEqual(['x1'])
  expect(ids('climbing', [{ start: '2026-01-01', end: '2026-01-31' }])).toEqual(
    [],
  )
  expect(ids('where does Grace live')).toEqual(['n1'])
})
