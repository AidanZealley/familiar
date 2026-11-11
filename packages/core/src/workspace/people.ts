import { defineDoc, type Tx } from '@earendil-works/pi-durable'
import { MESSAGE_LIMITS, type Author } from '../conversation/message.ts'

/**
 * What people are called. Hosts own who people are, and name each request's
 * author; a person can choose what Familiars call them instead, which wins
 * over the host's name from then on: on each message they post, so in the
 * room log and in what Familiars are shown. A host's `people` fill it in on
 * the first open only, as its default tools do, so a rename is never
 * overwritten.
 */
export type PeopleState = {
  /** By host author ID. */
  names: Record<string, string>
}

export const People = defineDoc<PeopleState>({
  kind: 'familiar.people',
  version: 1,
  scope: 'session',
  initial: () => ({ names: {} }),
  checkpointWhen: () => true, // a name or two: always store it whole
})

/** `author` as Familiars know them: with the name they chose, if they have. */
export const knownAs = (
  state: Readonly<PeopleState> | null | undefined,
  author: Author,
): Author => ({ id: author.id, name: state?.names[author.id] ?? author.name })

const bounded = (value: unknown, limit: number): value is string =>
  typeof value === 'string' && !!value.trim() && value.length <= limit

/**
 * Calls the person `id` `name` from now on. Throws a TypeError for an ID or
 * name a message's author couldn't have.
 */
export async function rename(tx: Tx, id: string, name: string) {
  if (
    !bounded(id, MESSAGE_LIMITS.authorId) ||
    !bounded(name, MESSAGE_LIMITS.authorName)
  ) {
    throw new TypeError(
      `A name must not be blank, and at most ${MESSAGE_LIMITS.authorName} characters.`,
    )
  }
  ;(await tx.doc(People)).names[id] = name
}

/**
 * Names `people`, as a host's `people` option does on the first open, which
 * creates the document, so watches attach to it, however many there are.
 */
export async function namePeople(tx: Tx, people: readonly Author[]) {
  await tx.doc(People)
  for (const { id, name } of people) {
    await rename(tx, id, name)
  }
}
