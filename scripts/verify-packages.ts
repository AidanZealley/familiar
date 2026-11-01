import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

// Installs the packed libraries outside the workspace, as a consumer would,
// so a file missing from `files`, a wrong export or a dependency that only
// resolves from the checkout fails here instead of after publishing.
const root = resolve(import.meta.dirname, '..')
const temporary = await mkdtemp(resolve(tmpdir(), 'familiar-packages-'))
const tarballs = resolve(temporary, 'tarballs')
const consumer = resolve(temporary, 'consumer')

const tsc = resolve(root, 'node_modules/.bin/tsc')
const workersTypes = JSON.parse(
  await readFile(resolve(root, 'packages/cloudflare/package.json'), 'utf8'),
).devDependencies['@cloudflare/workers-types']

const run = (command: string, args: string[], cwd: string) =>
  execFileSync(command, args, { cwd, stdio: 'inherit' })

try {
  // tsc never deletes output, so a stale dist could ship removed or excluded
  // modules. The release packs what this builds.
  for (const name of await readdir(resolve(root, 'packages'))) {
    await rm(resolve(root, 'packages', name, 'dist'), {
      recursive: true,
      force: true,
    })
  }
  run('pnpm', ['build:packages'], root)
  run(
    'pnpm',
    ['--filter', './packages/*', 'pack', '--pack-destination', tarballs],
    root,
  )

  const dependencies = Object.fromEntries(
    (await readdir(tarballs)).map((file) => {
      const tarball = resolve(tarballs, file)
      const manifest = execFileSync('tar', [
        '-xzOf',
        tarball,
        'package/package.json',
      ])
      return [JSON.parse(manifest.toString()).name, `file:${tarball}`]
    }),
  )
  await mkdir(consumer)
  await writeFile(
    resolve(consumer, 'package.json'),
    JSON.stringify({
      type: 'module',
      dependencies: {
        ...dependencies,
        '@cloudflare/workers-types': workersTypes,
      },
    }),
  )
  run('npm', ['install', '--no-audit', '--no-fund'], consumer)

  // Optional React must neither be installed nor loaded by vanilla consumers.
  assert.equal(
    (await readdir(resolve(consumer, 'node_modules'))).includes('react'),
    false,
  )

  // Node can't load Workers-only modules, so the Cloudflare package is only
  // type-checked.
  const runtime = [
    '@familiar-ai/core',
    '@familiar-ai/core/http',
    '@familiar-ai/core/diagnostics',
    '@familiar-ai/core/mcp',
    '@familiar-ai/client',
    '@familiar-ai/plugin-web',
    '@familiar-ai/plugin-web/convert-html',
  ]
  await writeFile(
    resolve(consumer, 'runtime.js'),
    runtime.map((name) => `import '${name}'\n`).join(''),
  )
  run('node', ['runtime.js'], consumer)

  const clientManifest = JSON.parse(
    await readFile(resolve(root, 'packages/client/package.json'), 'utf8'),
  )
  run(
    'npm',
    [
      'install',
      '--no-audit',
      '--no-fund',
      `react@${clientManifest.devDependencies.react}`,
      `@types/react@${clientManifest.devDependencies['@types/react']}`,
    ],
    consumer,
  )
  await writeFile(
    resolve(consumer, 'react.js'),
    `
import { FamiliarProvider, useFamiliar, useTranscript } from '@familiar-ai/client/react'
if (![FamiliarProvider, useFamiliar, useTranscript].every(value => typeof value === 'function')) {
  throw new Error('React bindings missing from the packed client')
}
`,
  )
  run('node', ['react.js'], consumer)

  // skipLibCheck, as most projects and Wrangler's templates set it: Pi's
  // dependencies bring Node and DOM globals that clash with Workers types.
  // That would also hide our declarations degrading to \`any\`, so each
  // entry point gets a misuse that must stay a type error.
  const typeCheck = async (
    name: string,
    lib: string[],
    types: string[],
    code: string,
  ) => {
    await writeFile(resolve(consumer, `${name}.ts`), code)
    await writeFile(
      resolve(consumer, `tsconfig.${name}.json`),
      JSON.stringify({
        compilerOptions: {
          target: 'es2023',
          lib,
          module: 'nodenext',
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          types,
        },
        files: [`${name}.ts`],
      }),
    )
    run(tsc, ['-p', `tsconfig.${name}.json`], consumer)
  }
  await typeCheck(
    'portable',
    ['ES2023', 'DOM'],
    [],
    `import { summonFamiliar } from '@familiar-ai/core'
import { createHttpApi, type HttpApi } from '@familiar-ai/core/http'
import { localDay } from '@familiar-ai/core/diagnostics'
import { connectMcp } from '@familiar-ai/core/mcp'
import { repeatText, type Schedule } from '@familiar-ai/client'
import { webPlugin } from '@familiar-ai/plugin-web'
import { convertHtml } from '@familiar-ai/plugin-web/convert-html'
import { hc } from 'hono/client'

// Assignable to every parameter, so each misuse below tests one parameter.
declare const ok: never

// @ts-expect-error
summonFamiliar(1)
// @ts-expect-error
export const familiar: Awaited<ReturnType<typeof summonFamiliar>> = 1
// @ts-expect-error
createHttpApi(1, ok)
// @ts-expect-error
createHttpApi(ok, 1)
// @ts-expect-error
hc<HttpApi>('http://localhost').notARoute
// @ts-expect-error
localDay('now', 'UTC')
// @ts-expect-error
export const day: number = localDay(0, 'UTC')
// @ts-expect-error
connectMcp(1, ok)
// @ts-expect-error
connectMcp('name', 1)
// @ts-expect-error
repeatText(1)
// @ts-expect-error
export const schedule: Schedule = 1
// @ts-expect-error
webPlugin(1)
// @ts-expect-error
export const plugin: number = webPlugin()
// @ts-expect-error
convertHtml(1, 'https://example.com', 100)
// @ts-expect-error
export const page: number = convertHtml('', 'https://example.com', 100)
`,
  )
  await typeCheck(
    'react',
    ['ES2023', 'DOM'],
    [],
    `import { createElement } from 'react'
import type { FamiliarStore } from '@familiar-ai/client'
import { FamiliarProvider, useFamiliar, useTranscript } from '@familiar-ai/client/react'
declare const store: FamiliarStore
store.getState()
store.getInitialState()
store.subscribe(state => state.connection)
// @ts-expect-error public stores do not expose arbitrary writes
type UnsupportedSetter = FamiliarStore['setState']
createElement(FamiliarProvider, { store })
// @ts-expect-error provider requires an explicit store
createElement(FamiliarProvider, {})
// @ts-expect-error selector state is typed
useFamiliar(state => state.notAField)
// @ts-expect-error selection preserves the return type
const count: number = useFamiliar(state => state.connection)
// @ts-expect-error transcript is typed
const transcript: number = useTranscript()
`,
  )
  await typeCheck(
    'workers',
    ['ES2023'],
    ['@cloudflare/workers-types'],
    `import { DurableFamiliar } from '@familiar-ai/cloudflare'

declare const ok: never

// @ts-expect-error
new DurableFamiliar(1, ok)
// @ts-expect-error
new DurableFamiliar(ok, 1)
`,
  )
  console.log('Packages install, load and type-check outside the workspace.')
} finally {
  await rm(temporary, { recursive: true, force: true })
}
