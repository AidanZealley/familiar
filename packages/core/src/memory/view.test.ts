import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux'
import type { EntryId, Harness } from '@earendil-works/pi-durable'
import { expect, test, vi } from 'vitest'
import { formatMessage, MESSAGE_KIND } from '../conversation/message.ts'
import { ReopenableStorage, TEST_ZONE, timeAt } from '../testing.ts'
import { createFamiliar, type FamiliarId } from '../workspace/familiars.ts'
import { withHarness } from './testing.ts'
import { Journal, keyOf, memoryOf, Pages } from './store.ts'
import { memoryViews } from './view.ts'

// Search: one index over exchanges, their journal lines and notes, kept up
// to date from commits, never reading a document once loaded.

const context = BACKGROUND_CONTEXT
const aidan = { id: 'aidan', name: 'Aidan' }

/** Appends a person's message and a reply at `minute`, returning the message's entry. */
async function say(
  harness: Harness,
  familiar: FamiliarId,
  minute: string,
  text: string,
) {
  const at = timeAt(minute)
  return harness.commit(async (tx) => {
    const entry = await tx.appendEntry(familiar, {
      kind: MESSAGE_KIND,
      model: [
        {
          role: 'user',
          content: formatMessage({ author: aidan, text }),
          timestamp: at,
        },
      ],
      data: { author: aidan, text },
    })
    await tx.appendEntry(familiar, {
      kind: 'pi.assistant',
      model: [{ ...fauxAssistantMessage('Noted.'), timestamp: at + 1 }],
    })
    return entry.id
  }, context)
}

test('an exchange is found by its journal lines and the days they name; notes by the subjects a query names; with totals, and no document read once loaded', async () => {
  await withHarness(new ReopenableStorage(), async (harness) => {
    const familiar = await harness.commit(
      (tx) => createFamiliar(tx, { name: 'Familiar' }),
      context,
    )
    const run = await say(
      harness,
      familiar,
      '2026-03-06 09:00',
      'Did it! 52 minutes, totally knackered.',
    )
    await say(harness, familiar, '2026-03-05 18:00', 'Pasta again for dinner.')
    await say(harness, familiar, '2026-03-10 09:00', 'Booked the dentist.')
    // The next input closes the last exchange.
    await say(harness, familiar, '2026-03-11 09:00', 'Morning.')

    const reads = vi.fn()
    const observer = {
      snapshot: ((...args: Parameters<Harness['snapshot']>) => {
        reads()
        return (harness.snapshot as (...a: unknown[]) => unknown)(...args)
      }) as Harness['snapshot'],
      snapshotAsOf: harness.snapshotAsOf.bind(harness),
      subscribeCommits: harness.subscribeCommits.bind(harness),
    }
    const view = memoryViews(observer, TEST_ZONE, context)(familiar)
    await view.ready()
    const search = (query: string, options = {}) =>
      harness.commit(async (tx) => {
        await view.catchUp(tx)
        return view.search(query, {
          now: timeAt('2026-03-12 09:00'),
          limit: 10,
          ...options,
        })
      }, context)

    // Nothing says "10k" or "race" yet.
    expect((await search('Leeds 10k race')).total).toBe(0)

    // Filing writes a line and a note; the view follows the commit.
    await harness.commit(async (tx) => {
      const memory = await memoryOf(tx, familiar, 'Familiar')
      memory.subjects.push({
        id: 's2',
        kind: 'person',
        name: 'Maya',
        aliases: ['Mum'],
        line: '',
        changed: 1,
      })
      memory.months.push('2026-03')
      ;(await tx.doc(Journal, keyOf(familiar, '2026-03'), null)).lines.push({
        exchange: run as EntryId,
        on: '2026-03-05',
        text: 'Aidan ran the Leeds 10k race.',
        subjects: [],
        quote: '52 minutes',
        saidBy: aidan,
      })
      ;(await tx.doc(Pages, keyOf(familiar, 's2'), null)).notes.push({
        id: 'n1',
        kind: 'preference',
        text: 'Prefers oat milk.',
        mentions: [],
        since: '2026-01-01',
        quote: 'oat milk',
        sources: [run as EntryId],
        saidBy: aidan,
        origin: 'inferred',
        saved: 1,
      })
    }, context)
    const readsBefore = reads.mock.calls.length

    const byKey = await search('Leeds 10k race')
    expect(byKey.total).toBe(1)
    expect(byKey.hits[0]).toMatchObject({
      kind: 'exchange',
      exchange: { id: `x${run}` },
      lines: [{ text: 'Aidan ran the Leeds 10k race.' }],
    })

    // The 5th: the run happened then, though it was said on the 6th, and
    // dinner was that day; the dentist wasn't.
    const fifth = await search('', {
      ranges: [{ start: '2026-03-05', end: '2026-03-05' }],
      dates: 'filter',
      kind: 'exchange',
    })
    expect(
      fifth.hits
        .map(
          (hit) => hit.kind === 'exchange' && hit.exchange.text.split('\n')[0],
        )
        .sort(),
    ).toEqual([
      'Did it! 52 minutes, totally knackered.',
      'Pasta again for dinner.',
    ])
    expect(fifth.total).toBe(2)
    const page = await search('', {
      ranges: [{ start: '2026-03-01', end: '2026-03-31' }],
      dates: 'filter',
      kind: 'exchange',
      limit: 1,
    })
    // The newest exchange waits for the next input: three in March so far.
    expect(page).toMatchObject({ total: 3 })
    expect(page.hits).toHaveLength(1)

    // A note on a subject the query names by an alias, without its words.
    const mum = await search('what does Mum like to drink')
    expect(mum.hits[0]).toMatchObject({
      kind: 'note',
      note: { id: 'n1' },
      subject: { name: 'Maya' },
    })

    expect(reads.mock.calls.length).toBe(readsBefore)
  })
})
