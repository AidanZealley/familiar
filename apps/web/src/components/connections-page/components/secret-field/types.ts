import type { ConnectionInfo } from '@familiar/client'

export type SecretFieldProps = {
  connection: Pick<ConnectionInfo, 'kind' | 'name'>
  secret: ConnectionInfo['secrets'][number]
}
