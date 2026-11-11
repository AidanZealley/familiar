import { describe, expect, it } from 'vitest'
import { composeMessage, type FamiliarSummary } from '@familiar-ai/client'
import { toParts } from './mentions'

const familiar = (id: number, name: string): FamiliarSummary => ({
  id: id as FamiliarSummary['id'],
  name,
})
const atlas = familiar(1, 'Atlas')
const pip = familiar(2, 'Pip')

describe('toParts', () => {
  it('mentions only the Familiars picked, wherever their names are', () => {
    const { text, mentions } = composeMessage(
      toParts('@Atlas ask @Pip, not email@Pip or @Atlassian', [atlas, pip]),
    )
    expect(text).toBe('@Atlas ask @Pip, not email@Pip or @Atlassian')
    expect(mentions).toEqual([
      { kind: 'familiar', id: '1', start: 0, end: 6 },
      { kind: 'familiar', id: '2', start: 11, end: 15 },
    ])
  })

  it('leaves a name typed without picking it as text', () => {
    expect(composeMessage(toParts('hi @Pip', [atlas])).mentions).toEqual([])
  })
})
