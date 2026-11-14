import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  SEED,
  selectSets,
  SET_SIZES,
  type Entry,
  type SetIds,
} from './longmem-data.ts'

/** The committed question IDs: the source of truth, written once from the seeded selection. */
export const setsFile = resolve(
  import.meta.dirname,
  '../../../../eval/longmem-sets.json',
)

/**
 * The dev and holdout IDs from `eval/longmem-sets.json`. The first run on a
 * clean checkout writes it from the seeded selection; it is committed so the
 * sets never move.
 */
export function readSets(entries: readonly Entry[]): SetIds {
  if (existsSync(setsFile)) {
    return JSON.parse(readFileSync(setsFile, 'utf8')) as SetIds
  }
  const sets = selectSets(entries)
  writeFileSync(
    setsFile,
    `${JSON.stringify({ seed: SEED, sizes: SET_SIZES, ...sets }, null, 2)}\n`,
  )
  console.log(`Chose the dev and holdout sets: ${setsFile}`)
  return sets
}
