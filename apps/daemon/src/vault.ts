import { fileVaultKey } from '@familiar-ai/core/node'
import { dataPath } from './config.ts'

/** Both credential stores share the daemon's private key. */
export const vaultKey = () =>
  fileVaultKey(dataPath('vault.key'), [
    dataPath('auth.json'),
    dataPath('secrets.json'),
  ])
