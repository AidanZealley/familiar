import { CopyIcon, KeyRoundIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { familiar, useFamiliar } from '@/lib/familiar'

const run = (action: () => Promise<void>) => () => void action().catch(() => {})

/**
 * Signing in to ChatGPT, shown above the composer whenever Familiar can't
 * reach its models. The code works from any device, so this one will do.
 */
export const SignIn = () => {
  const account = useFamiliar((state) => state.account)
  const [copied, setCopied] = useState(false)

  if (!account || account.status === 'signed-in') {
    return null
  }

  const { signIn, cancelSignIn } = familiar.getState()

  if (account.status === 'signing-in') {
    const { device } = account
    return (
      <section className="mx-4 flex flex-col gap-3 border bg-card p-3">
        {device ? (
          <>
            <p className="text-sm">
              Open{' '}
              <a
                href={device.url}
                target="_blank"
                rel="noreferrer"
                className="font-medium underline underline-offset-4"
              >
                {device.url.replace(/^https:\/\//, '')}
              </a>
              , sign in to ChatGPT and enter this code:
            </p>
            <div className="flex items-center gap-2">
              <code className="bg-muted px-3 py-2 font-mono text-lg tracking-widest select-all">
                {device.code}
              </code>
              <Button
                variant="outline"
                size="icon"
                aria-label="Copy code"
                onClick={() =>
                  void navigator.clipboard
                    ?.writeText(device.code)
                    .then(() => setCopied(true))
                    .catch(() => {})
                }
              >
                <CopyIcon />
              </Button>
              {copied && (
                <span className="text-xs text-muted-foreground">Copied</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Familiar carries on as soon as you're signed in.
            </p>
          </>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner />
            Getting a sign-in code…
          </p>
        )}
        <Button
          variant="ghost"
          className="self-start"
          onClick={run(cancelSignIn)}
        >
          Cancel
        </Button>
      </section>
    )
  }

  return (
    <section className="mx-4 flex items-center gap-3 border bg-card p-3">
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
        onClick={() => {
          setCopied(false)
          run(signIn)()
        }}
      >
        Sign in
      </Button>
    </section>
  )
}
