import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  cp,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { build } from 'rolldown'

// The computers' image is named by its key, a hash of exactly what goes into
// it, so it changes only when its contents do. This script is the one place
// that lists those contents: it stages them as the image's whole Docker build
// context and hashes every file there, so what's hashed is what's built.
//
//   node scripts/image-key.ts           stage image/, write image.json
//   node scripts/image-key.ts --build   and build the image for this machine
//
// The context: the Dockerfile (which pins its base image by digest and holds
// IMAGE_REFRESH, bumped to rebuild on purpose), the agent and proxy bundled
// into one file each, a manifest pinning Playwright, which the image installs
// with its browser, and the desktop and extension folders. Nothing else in the
// repository can change the key.

const computer = resolve(import.meta.dirname, '..')
const manifest = JSON.parse(
  await readFile(resolve(computer, 'package.json'), 'utf8'),
)

/** Where `pnpm image` stages the build context. */
export const IMAGE_CONTEXT = resolve(computer, 'image')

/** Writes the image's build context to `dir`, replacing what's there. */
export async function stageImage(dir: string) {
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  await build({
    cwd: computer,
    input: { agent: 'src/agent/main.ts', proxy: 'src/docker/proxy-main.ts' },
    platform: 'node',
    // Installed in the image instead, with the browser it downloads.
    external: ['playwright'],
    logLevel: 'warn',
    output: { dir, format: 'esm', entryFileNames: '[name].js' },
  })
  await writeFile(
    join(dir, 'package.json'),
    JSON.stringify(
      {
        private: true,
        type: 'module',
        dependencies: { playwright: manifest.devDependencies.playwright },
      },
      null,
      2,
    ) + '\n',
  )
  await cp(resolve(computer, 'Dockerfile'), join(dir, 'Dockerfile'))
  for (const folder of ['desktop', 'extension']) {
    await cp(resolve(computer, folder), join(dir, folder), { recursive: true })
  }
}

/**
 * The key of the build context in `dir`: every file's path, whether it's
 * executable and its contents, in path order. `key-` and 16 hex digits.
 */
export async function hashImage(dir: string) {
  const files = (await readdir(dir, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) =>
      relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'),
    )
    .sort()
  const hash = createHash('sha256')
  for (const file of files) {
    const path = join(dir, file)
    const executable = ((await stat(path)).mode & 0o111) !== 0
    const contents = await readFile(path)
    hash.update(`${file}\0${executable ? 'x' : '-'}\0${contents.length}\0`)
    hash.update(contents)
  }
  return `key-${hash.digest('hex').slice(0, 16)}`
}

/** The image's key for this checkout, staged in `dir`. */
export async function imageKey(dir = IMAGE_CONTEXT) {
  await stageImage(dir)
  return hashImage(dir)
}

/** Where the key every consumer reads is committed. */
export const IMAGE_JSON = resolve(computer, 'image.json')

if (import.meta.main) {
  const key = await imageKey()
  await writeFile(IMAGE_JSON, JSON.stringify({ key }, null, 2) + '\n')
  const image = `${manifest.config.image}:${key}`
  console.log(image)
  if (process.argv.includes('--build')) {
    execFileSync('docker', ['build', '--tag', image, IMAGE_CONTEXT], {
      stdio: 'inherit',
    })
  }
}
