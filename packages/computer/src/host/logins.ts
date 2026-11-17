import { mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import type { FamiliarId } from '@familiar-ai/core'
import { encryptedJsonFile } from '@familiar-ai/core/node'

/** A site's login, as the person entered it. */
export type Login = { username: string; password: string }

/** Each login by its site's exact origin, such as `https://example.com`. */
type Saved = Record<string, Login>

/**
 * The exact origin `site` names (protocol, host and port), taking a bare
 * host as https. Throws a message for the person or model when it isn't a
 * web address.
 */
export function originOf(site: string) {
  const trimmed = site.trim()
  let url: URL | undefined
  try {
    url = new URL(
      /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`,
    )
  } catch {
    // Said below.
  }
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) {
    throw new Error(`"${site}" isn't a website's address.`)
  }
  return url.origin
}

/**
 * Each computer's logins, in an encrypted file of its own under the host's
 * key, bound to its Familiar so one computer's file can't be read as
 * another's. Kept by `Computers`, which deletes them with the computer.
 */
export function computerLogins(dir: string, keyPath: string) {
  /**
   * Every password each computer has had saved while the host runs, kept
   * only in memory, so one replaced or deleted is still removed from what a
   * sign-in under way or a page that echoed it shows later. One deleted
   * before the host restarted is forgotten.
   */
  const known = new Map<FamiliarId, Set<string>>()
  const remember = (familiar: FamiliarId, password: string) => {
    const passwords = known.get(familiar) ?? new Set()
    known.set(familiar, passwords.add(password))
  }
  /** Remembers every password in `saved`, before it's replaced or deleted. */
  const rememberSaved = (familiar: FamiliarId, saved: Saved) => {
    for (const { password } of Object.values(saved)) {
      remember(familiar, password)
    }
  }

  const fileOf = (familiar: FamiliarId) =>
    encryptedJsonFile<Saved>(
      resolve(dir, `${familiar}.json`),
      keyPath,
      `computer-logins:${familiar}`,
      () => ({}),
    )

  return {
    /** Its sites and usernames, never the passwords. */
    list: (familiar: FamiliarId) =>
      Object.entries(fileOf(familiar).value).map(([site, { username }]) => ({
        site,
        username,
      })),
    /** `site`'s login, to give the computer. */
    get: (familiar: FamiliarId, site: string): Login | undefined =>
      fileOf(familiar).value[site],
    /** Saves `login` for `site`, an exact origin, in place of any before. */
    set: (familiar: FamiliarId, site: string, login: Login) => {
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      const file = fileOf(familiar)
      rememberSaved(familiar, file.value)
      file.save({ ...file.value, [site]: login })
      remember(familiar, login.password)
    },
    delete: (familiar: FamiliarId, site: string) => {
      const file = fileOf(familiar)
      rememberSaved(familiar, file.value)
      if (site in file.value) {
        const { [site]: _, ...rest } = file.value
        file.save(rest)
      }
    },
    /** Deletes them all, as the computer goes. */
    remove: (familiar: FamiliarId) => {
      rmSync(resolve(dir, `${familiar}.json`), { force: true })
      known.delete(familiar)
    },
    /**
     * `text` with every password `familiar`'s computer has (or has had,
     * while the host runs) removed (see `redact`), so a page or command
     * that shows one never reaches the model.
     */
    scrub: (familiar: FamiliarId, text: string) => {
      rememberSaved(familiar, fileOf(familiar).value)
      return redact(text, known.get(familiar) ?? [])
    },
  }
}

export type ComputerLogins = ReturnType<typeof computerLogins>

const REDACTED = '[saved password]'

/** The shortest piece of a password `redact` removes from an edge. */
const MIN_PIECE = 4

/**
 * `text` with each of `passwords` replaced, longest first so one inside
 * another goes whole. Then, since the computer cuts long results at their
 * start or end, perhaps through a password, a piece of one left at an edge
 * goes too: a start that ends a password, or an end that begins one.
 */
export function redact(text: string, passwords: Iterable<string>) {
  const sorted = [...passwords]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
  let redacted = sorted.reduce(
    (scrubbed, password) => scrubbed.replaceAll(password, REDACTED),
    text,
  )
  for (const password of sorted) {
    for (let length = password.length - 1; length >= MIN_PIECE; length--) {
      if (redacted.startsWith(password.slice(-length))) {
        redacted = REDACTED + redacted.slice(length)
        break
      }
    }
    for (let length = password.length - 1; length >= MIN_PIECE; length--) {
      if (redacted.endsWith(password.slice(0, length))) {
        redacted = redacted.slice(0, -length) + REDACTED
        break
      }
    }
  }
  return redacted
}
