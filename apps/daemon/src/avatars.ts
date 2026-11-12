import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Hono } from 'hono'

/** A portrait's name: its file's, without `.png`. Never a path. */
const NAME = /^[\w-]{1,64}$/

/**
 * The owner's own portraits for their Familiars: each a 64×32 PNG strip in
 * `dir`, frame 1 (mouth closed) then frame 2 (open). A Familiar's `avatar`
 * names one. Read on every request, so a strip added or removed shows
 * without a restart; without the folder there are none. The listing says
 * where the folder is, so the web UI can tell the owner where to add more.
 */
export const avatarRoutes = (dir: string) =>
  new Hono()
    .get('/', async (c) => {
      const files = await readdir(dir).catch(() => [])
      return c.json({
        folder: dir,
        names: files
          .filter((file) => file.endsWith('.png'))
          .map((file) => file.slice(0, -4))
          .filter((name) => NAME.test(name))
          .toSorted(),
      })
    })
    .get('/:file{.+\\.png}', async (c) => {
      const name = c.req.param('file').slice(0, -4)
      const image = NAME.test(name)
        ? await readFile(join(dir, `${name}.png`)).catch(() => undefined)
        : undefined
      return image
        ? c.body(image, 200, {
            'Content-Type': 'image/png',
            'Cache-Control': 'no-cache',
          })
        : c.notFound()
    })
