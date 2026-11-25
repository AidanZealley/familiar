// Building blocks for hosting a Familiar in a Node process: its secrets and
// model login in private files, one process per data directory, and the
// image processor for `images`. Plugins' network access needs nothing here:
// on Node it's core's default.
export { fileCredentialStore } from './credentials.ts'
export { jsonFile } from './json-file.ts'
export { lockDataDir, lockHeld, takeLock } from './lock.ts'
export { fileSecretStore } from './secrets.ts'
// Pi's Photon, in a worker thread that exits when idle; started on the first
// image, so importing this costs nothing.
export { createNodePhotonImages } from '@earendil-works/pi-durable/images/node'
