import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, renameSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

/**
 * LongMemEval (Wu et al., 2024; https://arxiv.org/abs/2410.10813), cleaned
 * release: its questions, the sessions each was asked over, and the labels
 * saying which turns hold the answer. The data is MIT licensed; see the
 * README.
 */

/** Where the evals keep their own credentials, saved runs and downloaded data. */
export const evalDirectory = (home = homedir()) =>
  join(home, '.local/share/familiar-eval')

const SOURCE =
  'https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_s_cleaned.json'
/** The SHA-256 the release is published with, checked after the download. */
const SHA256 =
  'd6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442'

/** Filler sessions per question in the small haystack, from its own haystack. */
export const FILLERS = 10
/** Fixed, so every run asks the same questions over the same histories. */
export const SEED = 'familiar-longmem-2'
/** The question types as the release names them. */
export const TYPES = [
  'single-session-user',
  'single-session-assistant',
  'single-session-preference',
  'multi-session',
  'knowledge-update',
  'temporal-reasoning',
] as const

export type QuestionType = (typeof TYPES)[number] | 'abstention'

/** Every stratum a set draws from: the six types, and unanswerable questions. */
export const STRATA: readonly QuestionType[] = [...TYPES, 'abstention']

/** Questions drawn per stratum for each set. The holdout is drawn after, from what is left. */
export const SET_SIZES: Record<
  'dev' | 'holdout',
  Record<QuestionType, number>
> = {
  dev: {
    'single-session-user': 5,
    'single-session-assistant': 4,
    'single-session-preference': 4,
    'multi-session': 8,
    'knowledge-update': 5,
    'temporal-reasoning': 8,
    abstention: 6,
  },
  holdout: {
    'single-session-user': 10,
    'single-session-assistant': 8,
    'single-session-preference': 6,
    'multi-session': 18,
    'knowledge-update': 10,
    'temporal-reasoning': 18,
    abstention: 10,
  },
}

export type QuestionSet = 'dev' | 'holdout' | 'milestone' | 'full'

type RawTurn = {
  role: 'user' | 'assistant'
  content: string
  has_answer?: boolean
}

/** A question as the release gives it. `answer` is sometimes a number. */
export type Entry = {
  question_id: string
  question_type: (typeof TYPES)[number]
  question: string
  /** `2023/05/30 (Tue) 23:40`, in no time zone. */
  question_date: string
  answer: string | number
  answer_session_ids: string[]
  /** One date per session, as `question_date`; not in order. */
  haystack_dates: string[]
  haystack_session_ids: string[]
  haystack_sessions: RawTurn[][]
}

export type Turn = {
  role: 'user' | 'assistant'
  text: string
  /** The release labels this turn as holding the answer. */
  hasAnswer: boolean
}

export type Session = {
  id: string
  /** When it began, in ms since the epoch. */
  at: number
  /** Whether the release lists it among the question's answer sessions. */
  evidence: boolean
  turns: Turn[]
}

/** A question and everything needed to write its history and ask it. */
export type Question = {
  id: string
  type: QuestionType
  question: string
  /** What the judge compares the reply to. */
  answer: string
  /** When it is asked, in ms since the epoch. */
  asked: number
  /** Oldest first; sessions with one date keep the release's order. */
  sessions: Session[]
}

export const isAbstention = (id: string) => id.endsWith('_abs')

export const typeOf = (entry: Pick<Entry, 'question_id' | 'question_type'>) =>
  isAbstention(entry.question_id)
    ? ('abstention' as const)
    : entry.question_type

/** `2023/05/30 (Tue) 23:40` as local time, as the rest of the eval's days are. */
export function parseDate(date: string) {
  const match = /^(\d{4})\/(\d{2})\/(\d{2}) \(\w+\) (\d{2}):(\d{2})$/.exec(date)
  if (!match) {
    throw new Error(`Unreadable LongMemEval date "${date}".`)
  }
  const [year, month, day, hour, minute] = match.slice(1).map(Number)
  return new Date(year, month - 1, day, hour, minute).getTime()
}

/** A small seeded generator (mulberry32), so a shuffle is the same on every machine. */
function random(seed: string) {
  const hash = createHash('sha256').update(seed).digest()
  let state = hash.readUInt32LE(0)
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** `items` in a seeded order, leaving them as they were. */
export function shuffled<T>(items: readonly T[], seed: string) {
  const next = random(seed)
  const result = [...items]
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(next() * (index + 1))
    ;[result[index], result[other]] = [result[other], result[index]]
  }
  return result
}

/**
 * `entry` as a question. A full haystack keeps every session; a small one
 * keeps the evidence sessions and `small` fillers from the question's own
 * haystack. Every session is written, whatever its turns look like.
 */
export function questionOf(
  entry: Entry,
  { small, seed = SEED }: { small?: number; seed?: string } = {},
): Question {
  const all = entry.haystack_session_ids.map((id, index) => ({
    id,
    index,
    at: parseDate(entry.haystack_dates[index]),
    evidence: entry.answer_session_ids.includes(id),
    turns: entry.haystack_sessions[index].map((turn) => ({
      role: turn.role,
      text: turn.content,
      hasAnswer: turn.has_answer === true,
    })),
  }))
  const kept =
    small === undefined
      ? all
      : [
          ...all.filter((session) => session.evidence),
          ...shuffled(
            all.filter((session) => !session.evidence),
            `${seed}:${entry.question_id}`,
          ).slice(0, small),
        ]
  return {
    id: entry.question_id,
    type: typeOf(entry),
    question: entry.question,
    answer: String(entry.answer),
    asked: parseDate(entry.question_date),
    sessions: kept
      .sort((a, b) => a.at - b.at || a.index - b.index)
      .map(({ id, at, evidence, turns }) => ({ id, at, evidence, turns })),
  }
}

export type SetIds = { dev: string[]; holdout: string[] }

/**
 * The dev and holdout sets: per stratum, a seeded shuffle of the questions
 * (ordered by ID first, so the file's order doesn't matter), dev taking the
 * first of each stratum and the holdout the next, so they never overlap.
 * Listed one stratum at a time in turn, so any prefix is mixed.
 */
export function selectSets(
  entries: readonly Pick<Entry, 'question_id' | 'question_type'>[],
  { sizes = SET_SIZES, seed = SEED } = {},
): SetIds {
  const ordered = [...entries].sort((a, b) =>
    a.question_id.localeCompare(b.question_id),
  )
  const drawn = (set: 'dev' | 'holdout') => {
    const groups = STRATA.map((stratum) => {
      const pool = shuffled(
        ordered.filter((entry) => typeOf(entry) === stratum),
        `${seed}:${stratum}`,
      ).map((entry) => entry.question_id)
      const before = set === 'dev' ? 0 : sizes.dev[stratum]
      return pool.slice(before, before + sizes[set][stratum])
    })
    const ids: string[] = []
    for (let round = 0; groups.some((group) => group[round]); round++) {
      ids.push(...groups.flatMap((group) => group[round] ?? []))
    }
    return ids
  }
  return { dev: drawn('dev'), holdout: drawn('holdout') }
}

/** The IDs `set` asks, in the order they are asked. */
export function idsOf(
  set: QuestionSet,
  sets: SetIds,
  entries: readonly Pick<Entry, 'question_id'>[],
) {
  switch (set) {
    case 'dev':
    case 'holdout':
      return sets[set]
    case 'milestone':
      return [...sets.dev, ...sets.holdout]
    case 'full':
      return entries.map((entry) => entry.question_id)
  }
}

/** The release's file, downloaded once into the eval's own directory. */
export async function ensureDataset(
  directory = join(evalDirectory(), 'longmemeval'),
  progress: (message: string) => void = () => {},
) {
  const file = join(directory, 'longmemeval_s_cleaned.json')
  if (existsSync(file)) {
    return file
  }
  progress(`Downloading ${SOURCE} to ${file}`)
  mkdirSync(directory, { recursive: true })
  const response = await fetch(SOURCE)
  if (!response.ok || !response.body) {
    throw new Error(`Downloading LongMemEval failed: ${response.status}.`)
  }
  const hash = createHash('sha256')
  const partial = `${file}.part`
  await pipeline(
    Readable.fromWeb(response.body),
    async function* (chunks: AsyncIterable<Buffer>) {
      for await (const chunk of chunks) {
        hash.update(chunk)
        yield chunk
      }
    },
    createWriteStream(partial),
  )
  if (hash.digest('hex') !== SHA256) {
    throw new Error(
      `The download at ${partial} is not the expected release (SHA-256 ${SHA256}); delete it and try again.`,
    )
  }
  renameSync(partial, file)
  return file
}

/** Every question in the downloaded release. */
export async function readDataset(file: string) {
  return JSON.parse(await readFile(file, 'utf8')) as Entry[]
}
