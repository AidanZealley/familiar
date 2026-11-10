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
import { createRequire } from 'node:module'

// Installs the packed libraries outside the workspace, as a consumer would,
// so a file missing from `files`, a wrong export or a dependency that only
// resolves from the checkout fails here instead of after publishing.
const root = resolve(import.meta.dirname, '..')
const temporary = await mkdtemp(resolve(tmpdir(), 'familiar-packages-'))
const tarballs = resolve(temporary, 'tarballs')
const consumer = resolve(temporary, 'consumer')

const manifest = async (name: string) =>
  JSON.parse(
    await readFile(resolve(root, 'packages', name, 'package.json'), 'utf8'),
  )
const run = (command: string, args: string[]) =>
  execFileSync(command, args, { cwd: consumer, stdio: 'inherit' })
const install = (...specs: string[]) =>
  run('npm', ['install', '--no-audit', '--no-fund', ...specs])

const core = await manifest('core')
const client = await manifest('client')
const cloudflare = await manifest('cloudflare')
// Every entry the source manifests export, so one missing from a package's
// publishConfig.exports fails to import.
const entries = [core, client].flatMap(({ name, exports }) =>
  Object.keys(exports).map((key) => name + key.slice(1)),
)

try {
  // tsc never deletes output, so a stale dist could ship removed or excluded
  // modules. The release packs what this builds.
  for (const name of await readdir(resolve(root, 'packages'))) {
    await rm(resolve(root, 'packages', name, 'dist'), {
      recursive: true,
      force: true,
    })
  }
  execFileSync('pnpm', ['build:packages'], { cwd: root, stdio: 'inherit' })
  execFileSync(
    'pnpm',
    ['--filter', './packages/*', 'pack', '--pack-destination', tarballs],
    { cwd: root, stdio: 'inherit' },
  )

  await mkdir(consumer)
  await writeFile(
    resolve(consumer, 'package.json'),
    JSON.stringify({ type: 'module' }),
  )
  install(
    ...(await readdir(tarballs)).map((file) => resolve(tarballs, file)),
    `@cloudflare/workers-types@${cloudflare.devDependencies['@cloudflare/workers-types']}`,
  )

  // React is an optional peer, so npm must not install it for vanilla hosts.
  assert.equal(
    (await readdir(resolve(consumer, 'node_modules'))).includes('react'),
    false,
  )

  // Two copies of a Pi package would split its registries and classes
  // between core, the client and Cloudflare.
  const pi = JSON.parse(
    execFileSync('npm', ['query', '[name^="@earendil-works/"]'], {
      cwd: consumer,
      encoding: 'utf8',
    }),
  ).map(({ name }: { name: string }) => name)
  assert.deepEqual(pi, [...new Set(pi)], 'Pi packages are installed twice')

  // Node can't load Workers-only modules, so the Cloudflare package is only
  // type-checked.
  const load = async (file: string, names: string[]) => {
    await writeFile(
      resolve(consumer, file),
      names.map((name) => `import '${name}'\n`).join(''),
    )
    run('node', [file])
  }
  const react = '@familiar-ai/client/react'
  await load(
    'runtime.js',
    entries.filter((name) => name !== react),
  )

  // A packed workspace runs a turn in a DM end to end.
  await writeFile(
    resolve(consumer, 'host.js'),
    `
import assert from 'node:assert/strict'
import { openWorkspace } from '@familiar-ai/core'
import { fauxAssistantMessage } from '@familiar-ai/core/models/faux'
import { scriptedModels } from '@familiar-ai/core/models/scripted'
import { MemoryStorage } from '@familiar-ai/core/storage/memory'
const models = scriptedModels(
  (request) => fauxAssistantMessage(request.type === 'message' ? 'Packed host works, ' + request.author.name : 'Background'),
  { models: [{ id: 'packed' }] },
)
const workspace = await openWorkspace({ storage: new MemoryStorage(), models, account: {}, model: { provider: 'faux', modelId: 'packed' }, timeZone: 'UTC' })
try {
  const familiar = await workspace.familiars.create({ name: 'Packed' })
  const dm = await workspace.rooms.get(await workspace.rooms.dm(familiar.id, 'consumer'))
  const entry = await dm.post({ author: { id: 'consumer', name: 'Consumer' }, text: 'Hello', requestId: 'packed' })
  // The reply lands in the room's log when the turn ends.
  const watch = await dm.watch()
  const reply = await new Promise((resolve) => {
    const find = (view) => view.entries.find((e) => e.kind === 'familiar.reply' && e.data.cause === entry)
    if (find(watch.value)) resolve(find(watch.value))
    watch.start(async (view) => { if (find(view)) resolve(find(view)) })
  })
  await watch.stop()
  assert.match(JSON.stringify(reply), /Packed host works, Consumer/)
} finally {
  await workspace.dismiss()
}
`,
  )
  run('node', ['host.js'])

  // The client in a browser build, with no workspace aliases, must not pull
  // in core's, Pi's or React's runtime.
  const requireWeb = createRequire(resolve(root, 'apps/web/package.json'))
  const { build } = await import(requireWeb.resolve('vite'))
  await writeFile(
    resolve(consumer, 'browser.js'),
    `export * from '@familiar-ai/client'`,
  )
  await build({
    configFile: false,
    root: consumer,
    logLevel: 'warn',
    plugins: [
      {
        name: 'check-client-runtime',
        moduleParsed(module: { id: string }) {
          assert.doesNotMatch(
            module.id,
            /node_modules\/(?:@familiar-ai\/core|@earendil-works\/pi-(?:ai|durable)|react)\//,
          )
        },
      },
    ],
    build: {
      write: false,
      lib: { entry: resolve(consumer, 'browser.js'), formats: ['es'] },
    },
  })

  install(
    `react@${client.devDependencies.react}`,
    `@types/react@${client.devDependencies['@types/react']}`,
  )
  await load('react.js', [react])

  // skipLibCheck, as most projects and Wrangler's templates set it: Pi's
  // dependencies bring Node and DOM globals that clash with Workers types.
  // That would also hide a declaration degrading to `any`, so each entry
  // point gets one misuse that must stay a type error.
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
    run(resolve(root, 'node_modules/.bin/tsc'), ['-p', `tsconfig.${name}.json`])
  }
  await typeCheck(
    'portable',
    ['ES2023', 'DOM'],
    [],
    `import { defineTool, Type } from '@familiar-ai/core'
import { createHttpApi, type HttpApi } from '@familiar-ai/core/http'
import { hook, ToolTask } from '@familiar-ai/core/extensions'
import { localDay } from '@familiar-ai/core/diagnostics'
import { MemoryStorage } from '@familiar-ai/core/storage/memory'
import { createModels } from '@familiar-ai/core/models'
import { openaiProvider } from '@familiar-ai/core/models/openai'
import { openrouterProvider } from '@familiar-ai/core/models/openrouter'
import { fauxProvider } from '@familiar-ai/core/models/faux'
import { scriptedModels } from '@familiar-ai/core/models/scripted'
import { createRoomStore } from '@familiar-ai/client'
import { useRoom } from '@familiar-ai/client/react'
import { hc, type InferResponseType } from 'hono/client'

// Assignable to every parameter, so each misuse below tests one parameter.
declare const ok: never

defineTool({
  name: 'search',
  description: 'Search',
  parameters: Type.Object({ query: Type.String() }),
  execute: async (args) => {
    // @ts-expect-error
    const query: number = args.query
    return { output: [{ type: 'text', text: String(query) }] }
  },
})
// @ts-expect-error
createHttpApi(1, ok)
// Core's route types read through Hono's client, as the client reads them.
declare const api: ReturnType<typeof hc<HttpApi>>
declare const page: InferResponseType<
  (typeof api.rooms)[':room']['history']['$get'],
  200
>
// @ts-expect-error
export const more: number = page.more
hook(ToolTask, {
  beforeTool: (call) => {
    // @ts-expect-error
    const name: number = call.name
    void name
  },
})
// @ts-expect-error
localDay('now', 'UTC')
// @ts-expect-error
new MemoryStorage(1)
// @ts-expect-error
createModels({ credentials: 42 })
// @ts-expect-error
openaiProvider(1)
// @ts-expect-error
openrouterProvider(1)
// @ts-expect-error
fauxProvider({ tokensPerSecond: 'fast' })
// @ts-expect-error
scriptedModels(1)
// @ts-expect-error
createRoomStore(1)
// @ts-expect-error
useRoom(1)
`,
  )
  await typeCheck(
    'workers',
    ['ES2023'],
    ['@cloudflare/workers-types'],
    `import { DurableWorkspace } from '@familiar-ai/cloudflare'
declare const ok: never
// @ts-expect-error
new DurableWorkspace(1, ok)
`,
  )

  console.log('Packages install, load and type-check outside the workspace.')
} finally {
  await rm(temporary, { recursive: true, force: true })
}
