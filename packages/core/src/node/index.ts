// Building blocks for hosting a Familiar in a Node process: its secrets and
// model login in private files, encrypted files for a plugin's own, and one
// process per data directory. Plugins' network access needs nothing here: on
// Node it's core's default.
export { fileCredentialStore } from './credentials.ts'
export { encryptedJsonFile } from './vault.ts'
export { jsonFile } from './json-file.ts'
export { lockDataDir } from './lock.ts'
export { fileSecretStore } from './secrets.ts'
