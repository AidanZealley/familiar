import type { FamiliarSummary } from '@familiar-ai/client'
import { expect, test } from 'vitest'
import { characterAvatar, INITIAL, portraitOf } from './avatars'
import { colourOf } from './characters'

const id = 7 as FamiliarSummary['id']

test('a stored avatar reads as its portrait, and anything unknown as its own character', () => {
  const images = ['016', 'fox']
  const of = (avatar?: string) => portraitOf({ id, avatar }, images)
  const own = { kind: 'character', shape: 7, colour: colourOf(7) }

  expect(of()).toEqual(own)
  expect(of(INITIAL)).toEqual({ kind: 'initial' })
  expect(of('pixel:42:3')).toEqual({ kind: 'character', shape: 42, colour: 3 })
  // Characters chosen before colours were apart keep their shape's colour.
  expect(of('pixel:42')).toEqual({
    kind: 'character',
    shape: 42,
    colour: colourOf(42),
  })
  // Images chosen before there were other kinds are stored by name alone.
  expect(of('016')).toEqual({ kind: 'image', name: '016' })
  expect(of('missing')).toEqual(own)
  expect(of('pixel:nope')).toEqual(own)
})

test('choosing the character its ID gives stores nothing', () => {
  expect(characterAvatar({ id }, 7, colourOf(7))).toBeNull()
  expect(characterAvatar({ id }, 7, (colourOf(7) + 1) % 10)).toBe(
    `pixel:7:${(colourOf(7) + 1) % 10}`,
  )
})
