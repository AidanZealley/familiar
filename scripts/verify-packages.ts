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
    '@familiar-ai/core/extensions',
    '@familiar-ai/core/diagnostics',
    '@familiar-ai/core/mcp',
    '@familiar-ai/core/storage/memory',
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
import { createHttpApi, conversationRoutes, memoryRoutes, eventRoutes, type HttpApi } from '@familiar-ai/core/http'
import { Hono } from 'hono'
import { hc, type InferResponseType } from 'hono/client'
declare const hostFamiliar: Awaited<ReturnType<typeof summonFamiliar>>
const composed = new Hono()
  .route('/chat', conversationRoutes(hostFamiliar, () => 'Sam'))
  .route('/memory', memoryRoutes(hostFamiliar.memory))
  .route('/', eventRoutes({ conversation: hostFamiliar.watch }))
const custom = hc<typeof composed>('https://example.com')
custom.chat.messages.$post({ json: { text: 'Hello', requestId: 'one' } })
// @ts-expect-error composed input remains typed
custom.chat.messages.$post({ json: { text: 1, requestId: 'one' } })
// @ts-expect-error omitted groups stay absent
custom.account.$post()
type Page = InferResponseType<typeof custom.chat.history.$get, 200>
declare const historyPage: Page
const more: boolean = historyPage.more
// @ts-expect-error composed response remains typed
const invalidMore: number = historyPage.more
const standard = hc<HttpApi>('https://example.com')
standard.messages.$post({ json: { text: 'Hello', requestId: 'two' } })
// @ts-expect-error standard input remains typed
standard.messages.$post({ json: { text: 1, requestId: 'two' } })
import { localDay } from '@familiar-ai/core/diagnostics'
import { connectMcp } from '@familiar-ai/core/mcp'
import { repeatText, type Schedule, type ModelRef, type ModelThinkingLevel, type ConversationView, type EntryRecord } from '@familiar-ai/client'
const model: ModelRef = { provider: 'packed', modelId: 'packed' }
const thinking: ModelThinkingLevel = 'medium'
// @ts-expect-error model selections remain typed
const invalidModel: ModelRef = { provider: 1 }
// @ts-expect-error full advanced history types remain typed
const entry: EntryRecord = 1
// @ts-expect-error advanced view stays typed
const view: ConversationView = 1
import { webPlugin } from '@familiar-ai/plugin-web'
import { convertHtml } from '@familiar-ai/plugin-web/convert-html'

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
export const api: HttpApi = 1
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
    'plugin',
    ['ES2023', 'DOM'],
    [],
    `import { definePlugin, defineTool, Type, type Static, type ToolContext, type ToolResult } from '@familiar-ai/core'
import { defineExtension, defineDoc, defineDocFamily, defineTask, section, hook, wrapTool, wrapSection, ToolTask, GenerationTask, configure, withCancel, createToolSearchExtension, createCodemodeExtension, createCodingTools, type ToolExecutionApi, type Extension, type Tx, type TaskRuntime } from '@familiar-ai/core/extensions'
const State = defineDoc({ kind: 'packed.state', version: 1, scope: 'session', initial: () => ({ value: 0 }), checkpointWhen: () => true })
const Task = defineTask<{ value: number }, { phase: 'run' }, number>({
  name: 'packed.task', version: 1, initial: () => ({ phase: 'run' }),
  phases: { run: (task, runtime, context) => runtime.commit(async tx => {
    (await tx.doc(State)).value = task.input.value
    return { status: 'terminal', outcome: { status: 'completed', result: task.input.value } }
  }, context) },
  abort: (_task, runtime, context) => runtime.commit(() => ({ status: 'terminal', outcome: { status: 'aborted' } }), context),
})
const search: Extension = createToolSearchExtension()
const coding: Extension = createCodingTools()
const extension: Extension = defineExtension({ name: 'packed', tasks: [Task], sections: [section('packed', () => 'Packed')], hooks: [hook(ToolTask, { beforeTool: call => {
  // @ts-expect-error hook inference must survive packing
  const invalid: number = call.name
} })], wraps: [wrapSection('packed', original => original)] })
const Parameters = Type.Object({ query: Type.String() })
type Args = Static<typeof Parameters>
const execute = async (args: Args, api: ToolExecutionApi, context: ToolContext): Promise<ToolResult> => {
  context.abortSignal?.throwIfAborted()
  await api.details({ source: args.query }, context)
  const derived = withCancel(context)
  derived.cancel()
  await api.commit(async tx => { (await tx.doc(State)).value = 1 }, context)
  await api.executeTool('other', { query: args.query }, context, { key: 'nested' })
  return { output: [{ type: 'text', text: args.query }], details: { count: 1 } }
}
export default definePlugin({
  name: 'packed', title: 'Packed plugin',
  extension: () => ({ ...extension, tools: [defineTool({ name: 'search', description: 'Search', parameters: Parameters, execute })] }),
})
defineTool({ name: 'typed', description: 'Typed', parameters: Parameters, execute: async args => {
  // @ts-expect-error schema inference must survive packing
  const invalid: number = args.query
  // @ts-expect-error no unsupported argument
  args.missing
  return { output: [{ type: 'text', text: args.query }] }
} })
declare const transaction: ToolExecutionApi['commit']
const precise = defineTool<typeof Parameters, { count: number }>({
  name: 'precise', description: 'Precise details', parameters: Parameters,
  execute: async (args, api, context) => {
    await api.details({ count: args.query.length }, context)
    // @ts-expect-error details type must survive packing
    await api.details({ count: 'wrong' }, context)
    return { details: { count: 1 } }
  },
})
const wrapped = wrapTool(precise, original => ({ ...original, execute: (args, api, context) => original.execute(args, api, context) }))
// @ts-expect-error tool execute retains all three required arguments
precise.execute({ query: 'value' })
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
const state = store.getState()
state.conversation.send('Hello')
state.conversation.setModel({ provider: 'test', modelId: 'test' })
state.conversation.setThinkingLevel('high')
state.conversation.loadOlder()
state.memory.revise('fact-1', 'Corrected')
state.memory.setPinned('fact-1', true)
state.memory.health()
state.account.signIn()
state.account.state?.status
state.memory.facts?.facts
state.memory.episodes?.episodes
state.schedules.items
state.schedules.cancel('schedule-1')
state.push.key()
state.connections.list()
state.mcp.add({ name: 'notes', transport: { type: 'stdio', command: 'notes', args: [] } })
state.transcript?.items
state.disconnect()
// @ts-expect-error old flat commands were removed
state.send('Hello')
// @ts-expect-error grouped command parameters remain typed
state.memory.revise(1, 'Corrected')
// @ts-expect-error grouped model commands retain Pi types
state.conversation.setThinkingLevel('unsupported')
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
  // Resolve the packed client in a browser build, with no workspace aliases.
  // Any server/React runtime import here is a packaging regression.
  const requireWeb = createRequire(resolve(root, 'apps/web/package.json'))
  const { build } = await import(requireWeb.resolve('vite'))
  await writeFile(
    resolve(consumer, 'browser.js'),
    `export * from '@familiar-ai/client'`,
  )
  await build({
    configFile: false,
    root: consumer,
    plugins: [
      {
        name: 'check-client-runtime',
        moduleParsed(module) {
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
  // Hosts deliberately configure providers directly. Install the owned version,
  // then exercise a real Familiar with that Models instance.
  const coreManifest = JSON.parse(
    await readFile(
      resolve(consumer, 'node_modules/@familiar-ai/core/package.json'),
      'utf8',
    ),
  )
  run(
    'npm',
    [
      'install',
      '--no-audit',
      '--no-fund',
      `@earendil-works/pi-ai@${coreManifest.dependencies['@earendil-works/pi-ai']}`,
    ],
    consumer,
  )
  await writeFile(
    resolve(consumer, 'host.js'),
    `
import assert from 'node:assert/strict'
import { createModels } from '@earendil-works/pi-ai/models'
import { Type as HostType } from '@earendil-works/pi-ai'
import { fauxProvider, fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux'
import { summonFamiliar, Type } from '@familiar-ai/core'
import { MemoryStorage } from '@familiar-ai/core/storage/memory'
import { GenerationTask, createContextKey } from '@familiar-ai/core/extensions'
const coreUrl = import.meta.resolve('@familiar-ai/core')
const durableUrl = import.meta.resolve('@earendil-works/pi-durable', coreUrl)
const durable = await import(durableUrl)
assert.equal(import.meta.resolve('@earendil-works/pi-ai/models'), import.meta.resolve('@earendil-works/pi-ai/models', coreUrl))
assert.equal(import.meta.resolve('@earendil-works/pi-ai/models'), import.meta.resolve('@earendil-works/pi-ai/models', durableUrl))
assert.equal(Type, HostType)
assert.equal(GenerationTask, durable.GenerationTask)
const chord = await import(import.meta.resolve('@earendil-works/chord/context', coreUrl))
assert.equal(createContextKey, chord.createContextKey)
const models = createModels()
const faux = fauxProvider({ models: [{ id: 'packed' }] })
models.setProvider(faux.provider)
faux.setResponses([fauxAssistantMessage('Packed host works')])
const familiar = await summonFamiliar({ storage: new MemoryStorage(), models, model: { provider: 'faux', modelId: 'packed' }, timeZone: 'UTC' })
try {
  await familiar.send({ author: 'Consumer', text: 'Hello', requestId: 'packed' })
  await familiar.idle()
  const view = await familiar.watch()
  assert.match(JSON.stringify(view.value), /Packed host works/)
  await view.stop()
} finally {
  await familiar.dismiss()
}
`,
  )
  run('node', ['--experimental-import-meta-resolve', 'host.js'], consumer)

  console.log('Packages install, load and type-check outside the workspace.')
} finally {
  await rm(temporary, { recursive: true, force: true })
}
