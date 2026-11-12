import { expect, test } from 'vitest'
import { characterOf, eyesPath } from './characters'

const cells = (path: string) => {
  const filled = new Set<string>()
  for (const [, x, y, w, h] of path.matchAll(/M(\d+) (\d+)h(\d+)v(\d+)/g)) {
    for (let i = 0; i < Number(w); i++) {
      for (let j = 0; j < Number(h); j++) {
        filled.add(`${Number(x) + i},${Number(y) + j}`)
      }
    }
  }
  return filled
}

// Eye placement depends on the shape's body and eye cut alone, 24 pairs; a thousand
// seeds lands on each of them many times over.
test('every character keeps its eyes on its body, wherever it looks', () => {
  const strays: string[] = []
  for (let seed = 1; seed <= 1000; seed++) {
    const character = characterOf(seed)
    const body = cells(character.body)
    for (const x of [-1, 0, 1]) {
      for (const y of [-1, 0, 1]) {
        for (const eye of cells(eyesPath(character.eyes, { x, y }))) {
          if (!body.has(eye)) {
            strays.push(`seed ${seed} looking ${x},${y}: ${eye}`)
          }
        }
      }
    }
  }
  expect(strays).toEqual([])
})
