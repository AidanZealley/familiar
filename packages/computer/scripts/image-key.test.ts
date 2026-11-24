import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { IMAGE_JSON, imageKey } from './image-key.ts'

// Hosts run the image image.json names, so a change to what goes into the
// image must come with its new key, or hosts would keep running the old agent.
test('image.json names the image this checkout builds', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'familiar-image-'))
  try {
    const { key } = JSON.parse(await readFile(IMAGE_JSON, 'utf8'))
    expect(
      key,
      'The computer image changed: run `pnpm image` and commit image.json.',
    ).toBe(await imageKey(dir))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
