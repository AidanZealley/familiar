import { Spinner } from '@/components/ui/spinner'
import { useFamiliar } from '@familiar-ai/client/react'
import { BrowserSignIn } from './components/browser-sign-in'
import { CancelSignIn } from './components/cancel-sign-in'
import { DeviceCode } from './components/device-code'
import { SignInPrompt } from './components/sign-in-prompt'

/**
 * Signing in to ChatGPT, shown above the composer whenever Familiar can't
 * reach its models. It works from any device, so this one will do. Hosts that
 * manage credentials themselves send no account, so it never shows.
 */
export const SignIn = () => {
  const account = useFamiliar((state) => state.account)

  if (!account || account.status === 'signed-in') {
    return null
  }

  return (
    <section className="mx-4 flex flex-col gap-3 border bg-card p-3">
      {account.status !== 'signing-in' ? (
        <SignInPrompt account={account} />
      ) : account.url && account.code ? (
        <DeviceCode url={account.url} code={account.code} />
      ) : account.url ? (
        <BrowserSignIn url={account.url} paste={account.paste ?? false} />
      ) : (
        <>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner />
            Starting sign-in…
          </p>
          <div>
            <CancelSignIn />
          </div>
        </>
      )}
    </section>
  )
}
