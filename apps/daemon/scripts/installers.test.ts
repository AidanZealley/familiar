import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, expect, test } from 'vitest'

const root = resolve(import.meta.dirname, '../../..')
const temporary: string[] = []
afterEach(() => {
  for (const directory of temporary.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})
const fixture = () => {
  const home = mkdtempSync(resolve(tmpdir(), "familiar installer's files & "))
  temporary.push(home)
  return home
}

test.skipIf(process.platform === 'win32').each([
  ['Linux', 'x86_64', false],
  ['Darwin', 'arm64', true],
])(
  'shell installer on %s downloads a release and reuses or installs Node',
  (os, arch, needsNode) => {
    const home = fixture()
    const bin = resolve(home, 'fake-bin')
    const runtime = resolve(home, 'runtime/bin')
    mkdirSync(bin)
    mkdirSync(runtime, { recursive: true })
    const executable = (file: string, source: string) =>
      writeFileSync(file, '#!/bin/sh\nset -eu\n' + source, { mode: 0o755 })
    executable(
      resolve(bin, 'uname'),
      'if [ "$1" = -s ]; then echo "$TEST_OS"; else echo "$TEST_ARCH"; fi\n',
    )
    executable(
      resolve(bin, 'node'),
      'if [ "$TEST_NEEDS_NODE" = 1 ]; then exit 1; fi\n',
    )
    executable(resolve(runtime, 'node'), 'exit 0\n')
    const npm = `printf '%s\\n' "$@" >> "$HOME/npm.log"
mkdir -p "$HOME/.local/bin"
printf '#!/bin/sh\\necho setup >> "$HOME/setup.log"\\n' > "$HOME/.local/bin/familiar"
chmod +x "$HOME/.local/bin/familiar"
`
    executable(resolve(bin, 'npm'), npm)
    executable(resolve(runtime, 'npm'), npm)
    const archive = `node-v24.19.0-${os === 'Linux' ? 'linux' : 'darwin'}-${arch === 'arm64' ? 'arm64' : 'x64'}.tar.gz`
    const packed = spawnSync('tar', [
      '-czf',
      resolve(home, archive),
      '-C',
      home,
      'runtime',
    ])
    expect(packed.status).toBe(0)
    const digest = createHash('sha256')
      .update(readFileSync(resolve(home, archive)))
      .digest('hex')
    writeFileSync(resolve(home, 'SHASUMS256.txt'), `${digest}  ${archive}\n`)
    writeFileSync(resolve(home, 'familiar.tgz'), 'release fixture')
    executable(
      resolve(bin, 'curl'),
      `printf '%s\\n' "$@" >> "$HOME/downloads.log"
url=$2
while [ "$1" != -o ]; do shift; done
cp "$HOME/\${url##*/}" "$2"
`,
    )
    const env = {
      ...process.env,
      HOME: home,
      SHELL: '/bin/zsh',
      PATH: `${bin}:${process.env.PATH}`,
      TEST_OS: os,
      TEST_ARCH: arch,
      TEST_NEEDS_NODE: needsNode ? '1' : '0',
      FAMILIAR_VERSION: 'v1.2.3',
      FAMILIAR_NO_SETUP: '1',
    }
    const run = () =>
      spawnSync('sh', [resolve(root, 'install.sh')], { env, encoding: 'utf8' })
    const first = run()
    expect(first.stderr, first.stdout).not.toContain('verification failed')
    expect(first.status, first.stderr).toBe(0)
    expect(readFileSync(resolve(home, 'downloads.log'), 'utf8')).toContain(
      '/releases/download/v1.2.3/familiar.tgz',
    )
    expect(readFileSync(resolve(home, 'npm.log'), 'utf8')).toContain(
      `--prefix\n${home}/.local`,
    )
    expect(run().status).toBe(0)
    expect(
      readFileSync(resolve(home, '.zshrc'), 'utf8').match(/export PATH/g),
    ).toHaveLength(1)
    if (needsNode) {
      expect(
        readFileSync(
          resolve(home, '.local/share/familiar-node/bin/node'),
          'utf8',
        ),
      ).toContain('exit 0')
    }
    writeFileSync(resolve(home, 'SHASUMS256.txt'), `bad  ${archive}\n`)
    if (needsNode) {
      rmSync(resolve(home, '.local/share/familiar-node'), { recursive: true })
      const failure = run()
      expect(failure.status).not.toBe(0)
      expect(failure.stderr).toContain('checksum verification failed')
    }
  },
)

test.skipIf(process.platform !== 'win32')(
  'PowerShell installer installs Node and the package in user-owned paths',
  () => {
    const home = fixture()
    const harness = resolve(home, 'test.ps1')
    const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'"
    writeFileSync(
      harness,
      `
$ErrorActionPreference = 'Stop'
$homeDir = ${quote(home)}
$env:LOCALAPPDATA = Join-Path $homeDir 'local'
$env:APPDATA = Join-Path $homeDir 'roaming'
$env:FAMILIAR_VERSION = 'v1.2.3'
$env:FAMILIAR_NO_SETUP = '1'
$oldPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$global:LASTEXITCODE = 0
function node { if (Test-Path (Join-Path $env:APPDATA 'npm/node.exe')) { 'v24.19.0' } else { 'v20.0.0' } }
function Get-Command { param($Name, $ErrorAction) @{ Source = (Join-Path $env:APPDATA 'npm/node.exe') } }
function npm.cmd { $args | Set-Content (Join-Path $homeDir 'npm.log'); $global:LASTEXITCODE = 0 }
function Invoke-WebRequest {
  param($Uri, $OutFile, [switch]$UseBasicParsing)
  Add-Content (Join-Path $homeDir 'downloads.log') $Uri
  if ($Uri -like '*/SHASUMS256.txt') {
    $zip = Get-ChildItem ([IO.Path]::GetDirectoryName($OutFile)) -Filter '*.zip' | Select-Object -First 1
    ((Get-FileHash $zip.FullName).Hash + '  ' + $zip.Name) | Set-Content $OutFile
  } elseif ($Uri -like '*.zip') {
    $folder = Join-Path $homeDir ([IO.Path]::GetFileNameWithoutExtension($Uri))
    New-Item -ItemType Directory -Force $folder | Out-Null
    Set-Content (Join-Path $folder 'node.exe') 'runtime fixture'
    Compress-Archive -Path $folder -DestinationPath $OutFile
  } else { Set-Content $OutFile 'release fixture' }
}
try {
  & ${quote(resolve(root, 'install.ps1'))}
  if (!(Test-Path (Join-Path $env:APPDATA 'npm/node.exe'))) { throw 'Node was not installed' }
  $entries = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (!$entries.Contains((Join-Path $env:APPDATA 'npm'))) { throw 'Missing npm PATH entry' }
  & ${quote(resolve(root, 'install.ps1'))}
} finally { [Environment]::SetEnvironmentVariable('Path', $oldPath, 'User') }
`,
    )
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => key.toLowerCase() !== 'psmodulepath',
      ),
    )
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        harness,
      ],
      { env, encoding: 'utf8', timeout: 30000 },
    )
    expect(result.status, result.stderr + result.stdout).toBe(0)
    expect(readFileSync(resolve(home, 'npm.log'), 'utf8')).toContain('--prefix')
    expect(readFileSync(resolve(home, 'downloads.log'), 'utf8')).toContain(
      '/releases/download/v1.2.3/familiar.tgz',
    )
  },
  35000,
)
