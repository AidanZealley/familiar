import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { readSettings, saveSettings } from './settings.ts'

const directories: string[] = []
const directory = () => {
  const path = mkdtempSync(join(tmpdir(), 'familiar-settings-'))
  directories.push(path)
  return path
}
afterEach(() => {
  for (const path of directories.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})

test('settings are defaults, then saved choices, then environment overrides', () => {
  const path = directory()
  expect(readSettings(path, {})).toEqual({
    explicit: {},
    name: 'Familiar',
    owner: 'owner',
    port: 4317,
  })
  writeFileSync(
    join(path, 'settings.json'),
    JSON.stringify({ name: 'Cat', owner: 'Aidan', model: 'saved-model' }),
  )
  expect(readSettings(path, {})).toMatchObject({
    explicit: { name: 'Cat', owner: 'Aidan', model: 'saved-model' },
    name: 'Cat',
    port: 4317,
  })
  expect(
    readSettings(path, {
      FAMILIAR_NAME: 'Other',
      FAMILIAR_MODEL: 'other-model',
      FAMILIAR_PORT: '4321',
    }),
  ).toMatchObject({
    explicit: {
      name: 'Other',
      owner: 'Aidan',
      model: 'other-model',
      port: 4321,
    },
    name: 'Other',
    owner: 'Aidan',
    port: 4321,
  })
})

test.each(['{', '{"port":"4317"}'])(
  'invalid saved settings name the file to fix: %s',
  (value) => {
    const path = directory()
    writeFileSync(join(path, 'settings.json'), value)
    expect(() => readSettings(path, {})).toThrow(
      `Cannot read ${join(path, 'settings.json')}`,
    )
  },
)

test.each(['', '3.5'])('an invalid environment port is refused: %o', (port) => {
  expect(() => readSettings(directory(), { FAMILIAR_PORT: port })).toThrow(
    'port must be an integer between 1 and 65535.',
  )
})

test('setup saves choices without pinning defaults, and preserves saved and environment choices', () => {
  const path = directory()
  const initial = readSettings(path, {})
  saveSettings(path, { ...initial.explicit, name: 'Willow' })
  expect(JSON.parse(readFileSync(join(path, 'settings.json'), 'utf8'))).toEqual(
    { name: 'Willow' },
  )
  expect(readSettings(path, {}).explicit.model).toBeUndefined()
  writeFileSync(
    join(path, 'settings.json'),
    JSON.stringify({ name: 'Willow', owner: 'Aidan', model: 'chosen-model' }),
  )
  const chosen = readSettings(path, { FAMILIAR_PORT: '4325' })
  saveSettings(path, chosen.explicit)
  expect(JSON.parse(readFileSync(join(path, 'settings.json'), 'utf8'))).toEqual(
    { name: 'Willow', owner: 'Aidan', model: 'chosen-model', port: 4325 },
  )
})
