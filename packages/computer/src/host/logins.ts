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
    get: (familiar: FamiliarId, site: string): Login | undefined =>
      fileOf(familiar).value[site],
    /** Saves `login` for `site`, an exact origin, in place of any before. */
    set: (familiar: FamiliarId, site: string, login: Login) => {
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      const file = fileOf(familiar)
      file.save({ ...file.value, [site]: login })
    },
    delete: (familiar: FamiliarId, site: string) => {
      const file = fileOf(familiar)
      if (site in file.value) {
        const { [site]: _, ...rest } = file.value
        file.save(rest)
      }
    },
    /** Deletes them all, as the computer goes. */
    remove: (familiar: FamiliarId) =>
      rmSync(resolve(dir, `${familiar}.json`), { force: true }),
    /**
     * `text` with every saved password of `familiar`'s computer replaced, so
     * a page or command that shows one never reaches the model.
     */
    scrub: (familiar: FamiliarId, text: string) =>
      Object.values(fileOf(familiar).value).reduce(
        (scrubbed, { password }) =>
          password
            ? scrubbed.replaceAll(password, '[saved password]')
            : scrubbed,
        text,
      ),
  }
}

export type ComputerLogins = ReturnType<typeof computerLogins>
