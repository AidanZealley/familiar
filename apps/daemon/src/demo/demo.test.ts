import { expect, test } from 'vitest'
import { OWNER_ID } from '../serve.ts'
import { openDemo } from './demo.ts'
import { memories } from './household/memory.ts'

test('the demo seeds its household without error', async () => {
  const workspace = await openDemo()
  try {
    const rooms = await workspace.rooms.list(OWNER_ID)
    expect(rooms).toHaveLength(8)
    expect(rooms.some((room) => room.turns.length)).toBe(true)

    // The seed tool fails, leaving memory empty, if a quote isn't in the story.
    for (const { id, name } of await workspace.familiars.list()) {
      const watch = await workspace.familiars.get(id)!.memory.watch()
      await watch.stop()
      expect(watch.value?.subjects).toHaveLength(memories[name].pages.length)
    }
  } finally {
    await workspace.dismiss()
  }
})
