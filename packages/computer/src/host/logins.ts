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
   * Every password each computer has been given or had saved while the host
   * runs, kept only in memory, so one replaced or deleted is still removed
   * from what a sign-in under way or a page that echoed it shows later.
   */
  const known = new Map<FamiliarId, Set<string>>()
  const remember = (familiar: FamiliarId, password: string) => {
    const passwords = known.get(familiar) ?? new Set()
    known.set(familiar, passwords.add(password))
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
    get: (familiar: FamiliarId, site: string): Login | undefined => {
      const login = fileOf(familiar).value[site]
      if (login) {
        remember(familiar, login.password)
      }
      return login
    },
    /** Saves `login` for `site`, an exact origin, in place of any before. */
    set: (familiar: FamiliarId, site: string, login: Login) => {
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      const file = fileOf(familiar)
      file.save({ ...file.value, [site]: login })
      remember(familiar, login.password)
    },
    delete: (familiar: FamiliarId, site: string) => {
      const file = fileOf(familiar)
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
     * while the host runs) replaced, so a page or command that shows one
     * never reaches the model. Longest first, so one inside another goes
     * whole.
     */
    scrub: (familiar: FamiliarId, text: string) =>
      [
        ...new Set([
          ...Object.values(fileOf(familiar).value).map(
            ({ password }) => password,
          ),
          ...(known.get(familiar) ?? []),
        ]),
      ]
        .filter(Boolean)
        .sort((a, b) => b.length - a.length)
        .reduce(
          (scrubbed, password) =>
            scrubbed.replaceAll(password, '[saved password]'),
          text,
        ),
  }
}

export type ComputerLogins = ReturnType<typeof computerLogins>
