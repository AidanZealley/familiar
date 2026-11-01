import type { AccountState } from '@familiar-ai/client'

export type SignInPromptProps = {
  account: Extract<AccountState, { status: 'signed-out' | 'expired' }>
}
