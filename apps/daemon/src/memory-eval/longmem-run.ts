import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { type QuestionType } from './longmem-data.ts'
import type { TokenTotals } from './model.ts'

/**
 * A run's saved work: each question's filing, reply and verdict, written as
 * they finish. Run again with the same command and what is saved is skipped;
 * run with a different model, set or code and it refuses rather than mix
 * results that don't compare.
 */

/** What identifies a run. Everything here must match for saved work to be reused. */
export type RunKey = {
  set: string
  haystack: 'full' | 'small'
  models: { memory: string; reply: string; judge: string }
  /** A hash of the code that decides what filing and replies do. */
  code: string
  /** The code hash of the run whose filed stores this one reuses (`--reask`). */
  filedBy?: string
}

export type Stage = { tokens: TokenTotals; elapsedMs: number }

/** One question's saved work, filled in stage by stage. */
export type Saved = {
  question: string
  type: QuestionType
  filing?: Stage
  reply?: Stage & { text: string }
  judge?: Stage & { correct: boolean; said: string }
}

export const isDone = (saved: Saved | undefined) => Boolean(saved?.judge)

/** A saved run's directory refuses a key that differs from the one it was made with. */
export class RunMismatch extends Error {}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export function openRun(
  directory: string,
  key: RunKey,
  { fresh = false } = {},
) {
  if (fresh) {
    rmSync(directory, { recursive: true, force: true })
  }
  mkdirSync(directory, { recursive: true })
  const keyFile = join(directory, 'run.json')
  if (existsSync(keyFile)) {
    const made = JSON.parse(readFileSync(keyFile, 'utf8')) as RunKey
    const differs = (
      ['set', 'haystack', 'models', 'code', 'filedBy'] as const
    ).filter((field) => !same(made[field], key[field]))
    if (differs.length) {
      throw new RunMismatch(
        `${directory} was made with a different ${differs
          .map(
            (field) =>
              `${field} (${JSON.stringify(made[field])}, not ${JSON.stringify(key[field])})`,
          )
          .join(
            ', ',
          )}. Its results can't be mixed with this run's: pass --fresh to start it again, or --run to keep both.`,
      )
    }
  } else {
    writeFileSync(keyFile, `${JSON.stringify(key, null, 2)}\n`)
  }

  const file = (id: string) => join(directory, `${id}.json`)
  return {
    directory,
    /** Where a question's filed store is kept. */
    storePath: (id: string) => join(directory, `${id}.sqlite`),
    read: (id: string) =>
      existsSync(file(id))
        ? (JSON.parse(readFileSync(file(id), 'utf8')) as Saved)
        : undefined,
    /** Written whole and renamed, so a stop never leaves half a record. */
    write(saved: Saved) {
      const temporary = `${file(saved.question)}.part`
      writeFileSync(temporary, `${JSON.stringify(saved, null, 2)}\n`)
      renameSync(temporary, file(saved.question))
    },
    /** Every saved question. */
    all: () =>
      readdirSync(directory)
        .filter((name) => name.endsWith('.json') && name !== 'run.json')
        .map(
          (name) =>
            JSON.parse(readFileSync(join(directory, name), 'utf8')) as Saved,
        ),
  }
}

export type Run = ReturnType<typeof openRun>

/** A run's key, as saved in its directory. */
export const keyOf = (directory: string) =>
  JSON.parse(readFileSync(join(directory, 'run.json'), 'utf8')) as RunKey

/**
 * Gives `to` the filed stores of every question `from` has filed and `to`
 * hasn't, so only the reply and the verdict run again. For changes that
 * touch only what a reply sees: filing stays as `from`'s code left it.
 */
export function reuseFilings(from: Run, to: Run) {
  for (const saved of from.all()) {
    const store = from.storePath(saved.question)
    if (!saved.filing || !existsSync(store) || to.read(saved.question)) {
      continue
    }
    for (const suffix of ['', '-wal', '-shm']) {
      if (existsSync(`${store}${suffix}`)) {
        copyFileSync(
          `${store}${suffix}`,
          `${to.storePath(saved.question)}${suffix}`,
        )
      }
    }
    to.write({
      question: saved.question,
      type: saved.type,
      filing: saved.filing,
    })
  }
}

/**
 * A hash of the code that decides what filing and a reply do: Familiar's own
 * sources, without tests, and the eval files that write histories and run the
 * stages. A change to any of them is a different system, so saved work is
 * not reused across it.
 */
export function codeHash(root = resolve(import.meta.dirname, '../../../..')) {
  const hash = createHash('sha256')
  const walk = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? walk(join(directory, entry.name))
        : /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
          ? [join(directory, entry.name)]
          : [],
    )
  const files = [
    ...walk(join(root, 'packages/core/src')),
    ...['longmem-history.ts', 'longmem.ts'].map((name) =>
      join(root, 'apps/daemon/src/memory-eval', name),
    ),
  ].sort()
  for (const path of files) {
    hash.update(path.slice(root.length)).update(readFileSync(path))
  }
  return hash.digest('hex').slice(0, 12)
}
