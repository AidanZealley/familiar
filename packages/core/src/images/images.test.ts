import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context'
import type { ImageProcessor } from '@earendil-works/pi-durable/tools'
import { expect, test, vi } from 'vitest'
import { withHarness } from '../memory/testing.ts'
import { ReopenableStorage } from '../testing.ts'
import { prepareImage } from './prepare.ts'
import { claimImages, Images, storeImage, UNCLAIMED_FOR } from './store.ts'

const image = (data: string) => ({
  data,
  mimeType: 'image/png',
  width: 1,
  height: 1,
})

test('an upload no message claims is retired a day later; a claimed one is kept', async () => {
  await withHarness(new ReopenableStorage(), async (harness) => {
    const ids = ['a'.repeat(32), 'b'.repeat(32)]
    await harness.commit(async (tx) => {
      await storeImage(tx, ids[0], image('QQ=='), 0)
      await storeImage(tx, ids[1], image('Qg=='), 0)
    }, context)
    await harness.commit((tx) => claimImages(tx, [ids[0]]), context)

    // The next upload after a day sweeps.
    await harness.commit(
      (tx) => storeImage(tx, 'c'.repeat(32), image('Qw=='), UNCLAIMED_FOR + 1),
      context,
    )
    expect(await harness.snapshot(Images, ids[0], context)).toMatchObject({
      data: 'QQ==',
    })
    expect(await harness.snapshot(Images, ids[1], context)).toBeUndefined()
    await expect(
      harness.commit((tx) => claimImages(tx, [ids[1]]), context),
    ).rejects.toMatchObject({ code: 'missing' })
  })
})

test('an image whose header declares too many pixels is refused before anything decodes it', async () => {
  // A PNG signature and IHDR declaring 100,000 × 100,000, with no pixels.
  const header = new Uint8Array(24)
  header.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  header.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8)
  const view = new DataView(header.buffer)
  view.setUint32(16, 100_000)
  view.setUint32(20, 100_000)
  const processor: ImageProcessor = { prepare: vi.fn() }

  await expect(
    prepareImage(processor, header, 40_000_000),
  ).rejects.toMatchObject({ code: 'too-large' })
  expect(processor.prepare).not.toHaveBeenCalled()
})
