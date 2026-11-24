import { execFile, spawn } from 'node:child_process'
import { access, mkdir, open, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ComputerDetail, ComputerRestore } from '../host.ts'
import { APT_BASELINE, RESTORED } from './layout.ts'

// A computer made again from a newer image has its home, but not what was
// installed outside it. Records on its disk, in ~/.familiar, say what to put
// back: `apt-packages`, which a dpkg hook in the image keeps (see
// restore/record-packages), and `setup.sh`, people's own script for the
// rest. The agent restores from them once per container, as the container
// first starts: the marker `RESTORED`, in the container's own layer, says
// it has.

/** How long restoring may take in all; then it stops, wherever it got to. */
export const RESTORE_LIMIT_MS = 10 * 60_000

type Outcome = NonNullable<ComputerRestore['setup']>

/** apt's package names, so a line can't pass for an option. */
const PACKAGE = /^[a-z0-9][a-z0-9+.:-]*$/

const lines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  )

/**
 * Restores the computer whose home is `home`, unless it has been already:
 * how it went, or `undefined` if it had been. It never fails: whatever
 * happens is in its outcome and in ~/.familiar/restore.log.
 */
export async function restore(
  home: string,
  limitMs = RESTORE_LIMIT_MS,
): Promise<ComputerRestore | undefined> {
  if (await exists(RESTORED)) {
    return undefined
  }
  const records = join(home, '.familiar')
  const baseline = new Set(
    lines(await readFile(APT_BASELINE, 'utf8').catch(() => '')),
  )
  const packages = lines(
    await readFile(join(records, 'apt-packages'), 'utf8').catch(() => ''),
  ).filter((name) => !baseline.has(name))
  const setup = join(records, 'setup.sh')
  const restored: ComputerRestore = {
    at: new Date().toISOString(),
    installed: [],
    missed: [],
  }
  if (packages.length || (await exists(setup))) {
    try {
      await restoreFrom(records, packages, setup, limitMs, restored)
    } catch (error) {
      // Such as a disk too full for the log: what's left is missed.
      restored.missed = packages.filter(
        (name) => !restored.installed.includes(name),
      )
      console.error(`Restoring failed: ${error}`)
    }
  }
  await writeFile(RESTORED, JSON.stringify(restored) + '\n').catch(
    (error: unknown) => console.error(`Couldn't record restoring: ${error}`),
  )
  return restored
}

async function restoreFrom(
  records: string,
  packages: string[],
  setup: string,
  limitMs: number,
  restored: ComputerRestore,
) {
  await mkdir(records, { recursive: true })
  const log = await open(join(records, 'restore.log'), 'w')
  const deadline = Date.now() + limitMs
  /** Runs `command` as root, its output in the log, within the time left. */
  const run = async (command: string[]): Promise<Outcome> => {
    const seconds = Math.ceil((deadline - Date.now()) / 1000)
    if (seconds <= 0) {
      return 'stopped'
    }
    await log.write(`\n$ ${command.join(' ')}\n`)
    // sudo clears the proxy's variables, which installers outside apt need.
    const proxy = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy']
      .filter((name) => process.env[name])
      .map((name) => `${name}=${process.env[name]}`)
    // `timeout`, as root, stops the command and what it started.
    const child = spawn(
      'sudo',
      [
        '-n',
        'timeout',
        '--kill-after=10',
        String(seconds),
        'env',
        'DEBIAN_FRONTEND=noninteractive',
        ...proxy,
        ...command,
      ],
      { cwd: join(records, '..'), stdio: ['ignore', log.fd, log.fd] },
    )
    const code = await new Promise<number | null>((resolve) => {
      child.on('error', () => resolve(null))
      child.on('close', resolve)
    })
    const outcome =
      code === 0 ? 'ran' : code === 124 || code === 137 ? 'stopped' : 'failed'
    await log.write(
      outcome === 'stopped'
        ? `Stopped at the ${limitMs / 60_000}-minute limit.\n`
        : `Exit code ${code}.\n`,
    )
    return outcome
  }

  try {
    const valid = packages.filter((name) => PACKAGE.test(name))
    restored.missed = packages.filter((name) => !PACKAGE.test(name))
    if (valid.length) {
      const updated = await run(['apt-get', 'update'])
      const all =
        updated === 'ran'
          ? await run(['apt-get', 'install', '-y', ...valid])
          : updated
      if (all === 'ran') {
        restored.installed = valid
      } else if (all === 'failed' && updated === 'ran') {
        // One by one, so one apt no longer has doesn't stop the rest.
        let outcome: Outcome = all
        for (const name of valid) {
          if (outcome !== 'stopped') {
            outcome = await run(['apt-get', 'install', '-y', name])
          }
          ;(outcome === 'ran' ? restored.installed : restored.missed).push(name)
        }
        restored.stopped = outcome === 'stopped' || undefined
      } else {
        restored.missed.push(...valid)
        restored.stopped = all === 'stopped' || undefined
      }
    }
    if (await exists(setup)) {
      restored.setup = await run(['bash', setup])
      restored.stopped ||= restored.setup === 'stopped' || undefined
    }
  } finally {
    await log.close()
  }
}

const listed = (names: string[]) =>
  names.length <= 5
    ? names.join(', ')
    : `${names.slice(0, 5).join(', ')} and ${names.length - 5} more`

const countOf = (count: number) =>
  `${count} apt package${count === 1 ? '' : 's'}`

/** What the Familiar is told of a restore, if there was anything to restore. */
export function noteOf(restored: ComputerRestore | undefined) {
  if (!restored) {
    return undefined
  }
  const { installed, missed, setup, stopped } = restored
  const said = [
    installed.length &&
      `Reinstalled ${countOf(installed.length)} (${listed(installed)}).`,
    missed.length &&
      `${countOf(missed.length)} couldn't be reinstalled (${listed(missed)}).`,
    setup === 'ran' && 'Ran ~/.familiar/setup.sh.',
    setup === 'failed' && '~/.familiar/setup.sh failed.',
    stopped &&
      `Restoring was stopped at its ${RESTORE_LIMIT_MS / 60_000}-minute limit.`,
  ].filter((part) => typeof part === 'string')
  if (!said.length) {
    return undefined
  }
  const trouble = missed.length || setup === 'failed' || stopped
  return said.join(' ') + (trouble ? ' See ~/.familiar/restore.log.' : '')
}

/**
 * Restores the computer whose home is `home` in the background. `done`
 * settles once it has finished; `takeNote` then answers its note, for the
 * Familiar, to the first caller only.
 */
export function restoring(home: string) {
  let note: string | undefined
  const done = restore(home).then((restored) => {
    note = noteOf(restored)
  })
  return {
    done,
    takeNote: () => {
      const taken = note
      note = undefined
      return taken
    },
  }
}

export type Restoring = ReturnType<typeof restoring>

/**
 * What's installed on the computer whose home is `home` beyond its image:
 * of the packages the records ask for, those dpkg says are installed, each
 * with apt's one-line summary, so one a restore missed isn't listed; and
 * how the last restore went if it put anything back, which names those
 * it missed.
 */
export async function installedOn(
  home: string,
): Promise<Pick<ComputerDetail, 'installed' | 'restored'>> {
  const records = join(home, '.familiar')
  const names = lines(
    await readFile(join(records, 'apt-packages'), 'utf8').catch(() => ''),
  ).filter((name) => PACKAGE.test(name))
  const installed = await installedOf(names)
  const restored = await readFile(RESTORED, 'utf8').then(
    (text) => JSON.parse(text) as ComputerRestore,
    () => undefined,
  )
  return {
    installed: {
      packages: names.flatMap((name) =>
        installed.has(name) ? [{ name, summary: installed.get(name) }] : [],
      ),
      setup: await exists(join(records, 'setup.sh')),
    },
    restored:
      restored &&
      (restored.installed.length || restored.missed.length || restored.setup)
        ? restored
        : undefined,
  }
}

/**
 * Those of `names` dpkg has installed, each with apt's one-line summary,
 * if it has one.
 */
const installedOf = (names: string[]) =>
  new Promise<Map<string, string | undefined>>((resolve) => {
    if (!names.length) {
      return resolve(new Map())
    }
    // A package dpkg has never seen fails the query, but the rest print.
    execFile(
      'dpkg-query',
      [
        '-W',
        '-f=${binary:Package}\t${db:Status-Abbrev}\t${binary:Summary}\n',
        '--',
        ...names,
      ],
      (_error, stdout) =>
        resolve(
          new Map(
            lines(stdout ?? '').flatMap((line) => {
              // Named as apt-mark names it, `name:arch` when it must be.
              const [name = '', status = '', summary] = line.split('\t')
              // Such as `ii`: the second letter is its state, `i` installed;
              // one removed but for its configuration files is `rc`.
              return status[1] === 'i'
                ? [[name, summary || undefined] as const]
                : []
            }),
          ),
        ),
    )
  })
