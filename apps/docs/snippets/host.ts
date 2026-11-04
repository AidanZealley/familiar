// Stand-ins for code only your host can write. The other snippets import
// them so they compile against Familiar's real types.
import type { Author, PluginFetch, SecretStore } from '@familiar-ai/core'
import type { CredentialStore } from '@familiar-ai/core/models'
import type { Storage } from '@familiar-ai/core/storage/memory'

/** Your session check: the signed-in person, or undefined to refuse. */
export declare function sessionAuthor(
  request: Request,
): Promise<Author | undefined>
/** Your rule for who administers this Familiar. */
export declare function isOwner(author: Author): boolean
/** Your persistent store for provider logins. */
export declare const credentials: CredentialStore
/** A stable ID for this installation. */
export declare function deviceId(): string
/** Persistent storage, such as Pi Durable's SQLite storage. */
export declare const storage: Storage
/** Your store for plugin secrets. */
export declare const secrets: SecretStore
/** A fetch that refuses private, loopback and tailnet destinations. */
export declare const publicOnlyFetch: PluginFetch
/** Your frontend's current credential. */
export declare function getCurrentToken(): Promise<string>
