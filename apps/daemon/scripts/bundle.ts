import { execFileSync } from 'node:child_process'
import {
  chmod,
  cp,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'rolldown'

const daemon = resolve(import.meta.dirname, '..')
const dist = resolve(daemon, 'dist')
const manifest = JSON.parse(
  await readFile(resolve(daemon, 'package.json'), 'utf8'),
)
const workspace = JSON.parse(
  await readFile(resolve(daemon, '../../package.json'), 'utf8'),
)

await rm(dist, { recursive: true, force: true })
await mkdir(dist, { recursive: true })
await build({
  input: {
    familiar: resolve(daemon, 'src/cli.ts'),
    'page-worker': resolve(daemon, 'src/page-worker.ts'),
    // This depends on the pinned Pi version's internal layout. Its opaque
    // loader expects this filename beside the provider's bundled code. Keep
    // the entry in sync with Pi upgrades; test:release checks both login and refresh.
    'openai-chatgpt': fileURLToPath(
      new URL(
        '../auth/oauth/openai-chatgpt.js',
        import.meta.resolve('@earendil-works/pi-ai/providers/openai'),
      ),
    ),
  },
  platform: 'node',
  external: ['piscina'],
  output: {
    dir: dist,
    format: 'esm',
    // Runtime paths are relative to the executing module. Keep chunks beside
    // the entries so the web assets and worker have the same location.
    entryFileNames: '[name].js',
    chunkFileNames: '[name]-[hash].js',
  },
})
await chmod(resolve(dist, 'familiar.js'), 0o755)
await cp(resolve(daemon, '../web/dist'), resolve(dist, 'web'), {
  recursive: true,
})
await writeFile(
  resolve(dist, 'package.json'),
  JSON.stringify(
    {
      name: 'familiar',
      version: (process.env.RELEASE_VERSION ?? '0.0.0').replace(/^v/, ''),
      description: 'A personal assistant with one durable conversation',
      type: 'module',
      bin: { familiar: 'familiar.js' },
      engines: workspace.engines,
      files: ['*.js', 'web'],
      dependencies: { piscina: manifest.dependencies.piscina },
    },
    null,
    2,
  ) + '\n',
)

const packed = JSON.parse(
  execFileSync('npm', ['pack', '--json'], {
    cwd: dist,
    encoding: 'utf8',
  }),
)
await rename(resolve(dist, packed[0].filename), resolve(dist, 'familiar.tgz'))
console.log(`Release package: ${resolve(dist, 'familiar.tgz')}`)
