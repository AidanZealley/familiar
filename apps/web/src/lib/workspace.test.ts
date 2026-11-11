import type { FamiliarSummary, RoomPreview } from '@familiar-ai/client'
import { describe, expect, it, vi } from 'vitest'
import { latestFirst, plainText, previewOf } from './workspace'

// Without the app's workspace connection, which opens on import.
vi.mock('./familiar', () => ({}))

const ada = { id: 1, name: 'Ada' } as FamiliarSummary
const at = 0
const entry = 1 as RoomPreview['entry']

describe('previewOf', () => {
  it('names who said it, the person as You, and a Familiar by its name now', () => {
    const me = { id: 'me', name: 'Sam' }
    expect(
      previewOf(
        { kind: 'message', author: me, text: 'Hi', at, entry },
        [ada],
        'me',
      ),
    ).toBe('You: Hi')
    expect(
      previewOf(
        { kind: 'message', author: me, text: 'Hi', at, entry },
        [ada],
        'other',
      ),
    ).toBe('Sam: Hi')
    expect(
      previewOf(
        {
          kind: 'reply',
          familiar: ada.id,
          name: 'Old name',
          outcome: 'answered',
          text: 'Sure',
          at,
          entry,
        } as RoomPreview,
        [ada],
        'me',
      ),
    ).toBe('Ada: Sure')
  })

  it('says a failed reply failed, whatever it said', () => {
    expect(
      previewOf(
        {
          kind: 'reply',
          familiar: 9,
          name: 'Gone',
          outcome: 'failed',
          text: 'partial',
          at,
          entry,
        } as RoomPreview,
        [ada],
        'me',
      ),
    ).toBe("Gone couldn't answer")
  })
})

describe('latestFirst', () => {
  it('puts the newest first and keeps the rest in their order', () => {
    const rooms = [
      { id: 1 },
      { id: 2, last: { at: 10 } },
      { id: 3 },
      { id: 4, last: { at: 20 } },
    ] as { id: number; last?: RoomPreview }[]
    expect(latestFirst(rooms, (room) => room.last).map(({ id }) => id)).toEqual(
      [4, 2, 1, 3],
    )
  })
})

describe('plainText', () => {
  it('shows markdown as its words', () => {
    expect(
      plainText(
        '## A quick tour This shows **Markdown**, `code` and a [link](https://example.com). ### Lists - Groceries',
      ),
    ).toBe(
      'A quick tour This shows Markdown, code and a link. Lists - Groceries',
    )
  })

  it('leaves snake_case and lone stars alone, and drops a leading list marker', () => {
    expect(plainText('- use fetch_page * 2')).toBe('use fetch_page * 2')
  })
})
