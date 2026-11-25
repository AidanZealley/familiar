import {
  chmod,
  cp,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { build } from 'rolldown'
import { runNpm } from '../src/cli/npm.ts'

const daemon = resolve(import.meta.dirname, '..')
const dist = resolve(daemon, 'dist')
const manifest = JSON.parse(
  await readFile(resolve(daemon, 'package.json'), 'utf8'),
)
const workspace = JSON.parse(
  await readFile(resolve(daemon, '../../package.json'), 'utf8'),
)
// Photon's image worker, which pi-durable starts from beside its own code,
// and the Photon it depends on, for its WebAssembly.
const local = createRequire(import.meta.url)
const photonWorker = resolve(
  local.resolve('@earendil-works/pi-durable/images/node'),
  '../node-worker.js',
)
const photon = createRequire(photonWorker)('@silvia-odwyer/photon/package.json')

await rm(dist, { recursive: true, force: true })
await mkdir(dist, { recursive: true })
await build({
  input: {
    familiar: resolve(daemon, 'src/cli.ts'),
    'page-worker': resolve(daemon, 'src/web/page-worker.ts'),
    // Beside the bundled code that starts it, as it is in pi-durable.
    'node-worker': photonWorker,
  },
  platform: 'node',
  external: ['@earendil-works/pi-codemode', 'piscina'],
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
      dependencies: {
        '@earendil-works/pi-codemode':
          manifest.dependencies['@earendil-works/pi-codemode'],
        // Its WebAssembly, which pi-durable finds as a package.
        '@silvia-odwyer/photon': photon.version,
        piscina: manifest.dependencies.piscina,
      },
    },
    null,
    2,
  ) + '\n',
)

const packed = JSON.parse(
  runNpm(['pack', '--json'], {
    cwd: dist,
  }),
)
await rename(resolve(dist, packed[0].filename), resolve(dist, 'familiar.tgz'))
console.log(`Release package: ${resolve(dist, 'familiar.tgz')}`)
