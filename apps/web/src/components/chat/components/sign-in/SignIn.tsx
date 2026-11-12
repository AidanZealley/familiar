import { useMutationState } from '@tanstack/react-query'
import { cn } from 'cn'
import { PixelCat } from '@/components/pixel-cat'
import { useWorkspace } from '@/lib/familiar'
import { BrowserSignIn } from './components/browser-sign-in'
import { CancelSignIn } from './components/cancel-sign-in'
import { SignInPrompt } from './components/sign-in-prompt'
import type { SignInProps } from './types'

/**
 * Signing in to ChatGPT, shown above the composer and in Settings › Model
 * account whenever Familiar can't reach its models. It works from any
 * device, so this one will do. Hosts that manage credentials themselves
 * send no account, so it never shows.
 */
export const SignIn = ({ className }: SignInProps) => {
  const account = useWorkspace((state) => state.account)
  // A request refused on its way. How the sign-in itself went arrives as
  // the account's own state.
  const error = useMutationState({
    filters: { mutationKey: ['sign-in'] },
    select: (mutation) => mutation.state.error,
  }).at(-1)

  if (!account || account.status === 'signed-in') {
    return null
  }

  return (
    <section
      className={cn('mx-4 flex flex-col gap-3 border bg-card p-3', className)}
    >
      {account.status !== 'signing-in' ? (
        <SignInPrompt account={account} />
      ) : account.url ? (
        <BrowserSignIn url={account.url} paste={account.paste ?? false} />
      ) : (
        <>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <PixelCat animated className="size-4" />
            Starting sign-in…
          </p>
          <div>
            <CancelSignIn />
          </div>
        </>
      )}
      {error && <p className="text-xs text-destructive">{error.message}</p>}
    </section>
  )
}
