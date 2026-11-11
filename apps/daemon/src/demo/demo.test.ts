import { expect, test } from 'vitest'
import { OWNER_ID } from '../serve.ts'
import { openDemo } from './demo.ts'

test('the demo seeds its household without error', async () => {
  const workspace = await openDemo()
  try {
    const rooms = await workspace.rooms.list(OWNER_ID)
    expect(rooms).toHaveLength(8)
    expect(rooms.some((room) => room.turns.length)).toBe(true)
  } finally {
    await workspace.dismiss()
  }
})
