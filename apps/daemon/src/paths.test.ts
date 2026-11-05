import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { resolvePaths } from './paths.ts'

const directories: string[] = []
const homeDirectory = () => {
  const path = mkdtempSync(join(tmpdir(), 'familiar-paths-'))
  directories.push(path)
  return path
}
afterEach(() => {
  for (const path of directories.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})

test.each([
  ['linux', '.local/share/familiar'],
  ['darwin', 'Library/Application Support/Familiar'],
  ['win32', 'AppData/Local/Familiar'],
] as const)(
  'new installations use the %s location without creating it',
  (platform, suffix) => {
    const home = homeDirectory()
    const { dataDir } = resolvePaths({ env: {}, platform, home })
    expect(dataDir).toBe(join(home, suffix))
    expect(existsSync(dataDir)).toBe(false)
  },
)

test('platform variables and the explicit data override are respected', () => {
  const home = homeDirectory()
  expect(
    resolvePaths({
      home,
      platform: 'linux',
      env: { XDG_DATA_HOME: join(home, 'xdg') },
    }).dataDir,
  ).toBe(join(home, 'xdg/familiar'))
  expect(
    resolvePaths({
      home,
      platform: 'win32',
      env: { LOCALAPPDATA: join(home, 'local') },
    }).dataDir,
  ).toBe(join(home, 'local/Familiar'))
  expect(
    resolvePaths({
      home,
      platform: 'darwin',
      env: { FAMILIAR_DATA_DIR: join(home, 'custom') },
    }).dataDir,
  ).toBe(join(home, 'custom'))
})

test('a checkout and an installed bundle each find their web UI and working directory', () => {
  const home = homeDirectory()
  const source = resolvePaths({
    home,
    env: {},
    codeDir: join(home, 'repo/apps/daemon/src'),
  })
  expect(source).toMatchObject({
    workDir: join(home, 'repo'),
    cliPath: join(home, 'repo/apps/daemon/src/cli.ts'),
    webDir: join(home, 'repo/apps/web/dist'),
  })
  const bundle = resolvePaths({ home, env: {}, codeDir: join(home, 'package') })
  expect(bundle).toMatchObject({
    workDir: join(home, 'package'),
    cliPath: join(home, 'package/familiar.js'),
    webDir: join(home, 'package/web'),
  })
})
