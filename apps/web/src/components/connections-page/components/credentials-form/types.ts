import type { ConnectionInfo } from '@familiar/client'

export type CredentialsFormProps = {
  connection: ConnectionInfo
  /** Why the drawer opened, such as a token that failed to save. */
  error?: string
  onDone(): void
}
