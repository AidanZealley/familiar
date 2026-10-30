import type { AccountState } from '@familiar/client'

export type SignInPromptProps = {
  account: Extract<AccountState, { status: 'signed-out' | 'expired' }>
}
