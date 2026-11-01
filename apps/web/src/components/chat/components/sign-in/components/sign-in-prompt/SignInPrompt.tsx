import { KeyRoundIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { familiar } from '@/lib/familiar'
import type { SignInPromptProps } from './types'

/** Why Familiar needs a sign-in, and the button that starts one. */
export const SignInPrompt = ({ account }: SignInPromptProps) => (
  <div className="flex items-center gap-3">
    <span className="grid size-9 shrink-0 place-items-center bg-primary/10 text-primary">
      <KeyRoundIcon className="size-[1.125rem]" />
    </span>
    <div className="min-w-0 flex-1">
      <h2 className="text-sm font-medium">
        {account.status === 'expired'
          ? 'Your ChatGPT sign-in stopped working'
          : 'Sign in to ChatGPT'}
      </h2>
      <p className="text-xs text-muted-foreground">
        Familiar answers through your ChatGPT subscription.
      </p>
      {account.error && (
        <p className="mt-1 text-xs text-destructive">{account.error}</p>
      )}
    </div>
    <Button
      onClick={() =>
        void familiar
          .getState()
          .account.signIn()
          .catch(() => {})
      }
    >
      Sign in
    </Button>
  </div>
)
