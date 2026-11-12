import { resolve } from 'node:path'
import { includeIgnoreFile } from '@eslint/compat'
import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

// The packages are what other apps embed, so they must run anywhere a host can
// (Node, Cloudflare Workers, browsers). Node-only code belongs in core's
// `node` entry, the building blocks for Node hosts, or in apps/daemon.
const nodeOnly = [
  {
    group: ['node:*'],
    message:
      'Packages must stay portable; Node-only code goes in packages/core/src/node or apps/daemon.',
  },
  {
    regex: '^@earendil-works/[^/]+/(.+/)?node$',
    message:
      'Packages must stay portable; Node-only code goes in packages/core/src/node or apps/daemon.',
  },
]

// Workers-only code belongs in packages/cloudflare, the one package that
// targets a single runtime.
const workersOnly = [
  {
    group: ['cloudflare:*', '@familiar-ai/cloudflare'],
    message:
      'Packages must stay portable; Workers-only code goes in packages/cloudflare.',
  },
  {
    regex: '^@earendil-works/[^/]+/(.+/)?cloudflare$',
    message:
      'Packages must stay portable; Workers-only code goes in packages/cloudflare.',
  },
]

const portable = [...nodeOnly, ...workersOnly]

// The client ships to browsers, so it shares core's and Pi's types but never
// their code. Chord is the exception: the client applies its ops.
const typesOnlyFromPi = {
  group: [
    '@earendil-works/pi-ai',
    '@earendil-works/pi-ai/*',
    '@earendil-works/pi-durable',
    '@earendil-works/pi-durable/*',
  ],
  message: 'The client may only import types from Pi.',
  allowTypeImports: true,
}

const typesOnlyFromCore = [
  '@familiar-ai/core',
  '@familiar-ai/core/http',
  '@familiar-ai/core/diagnostics',
].map((name) => ({
  name,
  message: 'The client may only import types from core.',
  allowTypeImports: true,
}))

export default defineConfig([
  includeIgnoreFile(resolve(import.meta.dirname, '.gitignore')),
  globalIgnores([
    'apps/web/src/routeTree.gen.ts',
    // Copied in by the shadcn CLI and updated through it, like apps/web's ui.
    'examples/embedded-kanban/src/components/ui',
    'examples/embedded-kanban/src/components/reui',
    'examples/shared-conversation/src/components/ui',
  ]),
  {
    files: ['**/*.{ts,tsx,js}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    rules: {
      curly: ['error', 'all'],
      // Leaving a property out with a rest spread is a use.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { ignoreRestSiblings: true },
      ],
    },
  },
  // typescript-eslint turns off no-undef for TypeScript, so only the
  // service worker, the one script, needs its globals named.
  {
    files: ['apps/web/public/sw.js'],
    languageOptions: { globals: globals.serviceworker },
  },
  {
    files: ['packages/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        { patterns: portable },
      ],
    },
  },
  {
    files: ['packages/cloudflare/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        { patterns: nodeOnly },
      ],
    },
  },
  {
    // Node-only: core's Node helpers.
    files: ['packages/core/src/node/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        { patterns: workersOnly },
      ],
    },
  },
  {
    files: ['packages/client/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        { patterns: [...portable, typesOnlyFromPi], paths: typesOnlyFromCore },
      ],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}', 'examples/*/src/**/*.tsx'],
    extends: [reactHooks.configs.flat.recommended],
  },
])
