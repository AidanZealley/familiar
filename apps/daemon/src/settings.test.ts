import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { readSettings } from './settings.ts'

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

test('missing settings use defaults, with environment overrides', () => {
  const path = directory()
  expect(readSettings(path, {})).toMatchObject({
    name: 'Familiar',
    owner: 'owner',
    port: 4317,
  })
  expect(
    readSettings(path, { FAMILIAR_PORT: '5000', FAMILIAR_NAME: 'Cat' }),
  ).toMatchObject({ name: 'Cat', port: 5000 })
})

test('saved settings survive a new process environment and individual overrides', () => {
  const path = directory()
  writeFileSync(
    join(path, 'settings.json'),
    JSON.stringify({
      name: 'Cat',
      owner: 'Aidan',
      model: 'saved-model',
      port: 4320,
    }),
  )
  expect(readSettings(path, {})).toEqual({
    name: 'Cat',
    owner: 'Aidan',
    model: { provider: 'openai', modelId: 'saved-model' },
    port: 4320,
  })
  expect(
    readSettings(path, {
      FAMILIAR_NAME: 'Other',
      FAMILIAR_OWNER: 'Rowan',
      FAMILIAR_MODEL: 'other-model',
      FAMILIAR_PORT: '4321',
    }),
  ).toEqual({
    name: 'Other',
    owner: 'Rowan',
    model: { provider: 'openai', modelId: 'other-model' },
    port: 4321,
  })
})

test.each([
  '{',
  'null',
  '[]',
  '{"name":42}',
  '{"owner":""}',
  '{"model":false}',
  '{"port":0}',
  '{"port":65536}',
  '{"port":"4317"}',
])('invalid saved settings explain which file needs fixing: %s', (value) => {
  const path = directory()
  writeFileSync(join(path, 'settings.json'), value)
  expect(() => readSettings(path, {})).toThrow(
    `Cannot read ${join(path, 'settings.json')}`,
  )
})

test.each(['', 'NaN', '-1', '3.5', '65536'])(
  'invalid environment port is refused: %s',
  (port) => {
    expect(() => readSettings(directory(), { FAMILIAR_PORT: port })).toThrow(
      'port must be an integer',
    )
  },
)
