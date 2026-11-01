import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

// The packages are what other apps embed, so they must run anywhere a host can
// (Node, Cloudflare Workers, browsers). Node-only code belongs in apps/daemon.
const nodeOnly = [
  {
    group: ['node:*'],
    message: 'Packages must stay portable; Node-only code goes in apps/daemon.',
  },
  {
    regex: '^@earendil-works/[^/]+/(.+/)?node$',
    message: 'Packages must stay portable; Node-only code goes in apps/daemon.',
  },
]

// Workers-only code belongs in packages/cloudflare, the one package that
// targets a single runtime.
const portable = [
  ...nodeOnly,
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
  globalIgnores([
    '**/dist',
    '**/.wrangler',
    'data',
    '.claude',
    'apps/web/src/routeTree.gen.ts',
  ]),
  {
    files: ['**/*.{ts,tsx,js}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    rules: { curly: ['error', 'all'] },
  },
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
    files: ['packages/client/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        { patterns: [...portable, typesOnlyFromPi], paths: typesOnlyFromCore },
      ],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: { globals: globals.browser },
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  {
    files: ['apps/daemon/**/*.ts', '*.js'],
    languageOptions: { globals: globals.node },
  },
])
