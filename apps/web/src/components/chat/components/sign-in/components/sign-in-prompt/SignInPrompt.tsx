import { useMutation } from '@tanstack/react-query'
import { KeyRoundIcon } from 'lucide-react'
import { IconTile } from '@/components/icon-tile'
import { Button } from '@/components/ui/button'
import { workspace } from '@/lib/familiar'
import type { SignInPromptProps } from './types'

/** Why Familiar needs a sign-in, and the button that starts one. */
export const SignInPrompt = ({ account }: SignInPromptProps) => {
  const signIn = useMutation({
    mutationKey: ['sign-in'],
    mutationFn: () => workspace.account.signIn(),
  })

  return (
    <div className="flex items-center gap-3">
      <IconTile icon={KeyRoundIcon} />
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
      <Button disabled={signIn.isPending} onClick={() => signIn.mutate()}>
        Sign in
      </Button>
    </div>
  )
}
