import { CopyIcon, KeyRoundIcon } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { familiar, useFamiliar } from '@/lib/familiar'

const run = (action: () => Promise<void>) => () => void action().catch(() => {})

/**
 * Signing in to ChatGPT, shown above the composer whenever Familiar can't
 * reach its models. It works from any device, so this one will do.
 */
export const SignIn = () => {
  const account = useFamiliar((state) => state.account)
  const [copied, setCopied] = useState(false)
  const [address, setAddress] = useState('')

  if (!account || account.status === 'signed-in') {
    return null
  }

  const { signIn, answerSignIn, cancelSignIn } = familiar.getState()

  if (account.status === 'signing-in') {
    const { url, code, paste } = account

    const submit = (event: FormEvent) => {
      event.preventDefault()
      const text = address.trim()
      if (text) {
        setAddress('')
        run(() => answerSignIn(text))()
      }
    }

    return (
      <section className="mx-4 flex flex-col gap-3 border bg-card p-3">
        {!url ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner />
            Starting sign-in…
          </p>
        ) : (
          <p className="text-sm">
            Open{' '}
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="font-medium underline underline-offset-4"
            >
              {code ? new URL(url).host + new URL(url).pathname : 'this link'}
            </a>{' '}
            and sign in to ChatGPT{code ? ', then enter this code:' : '.'}
          </p>
        )}
        {code && (
          <div className="flex items-center gap-2">
            <code className="bg-muted px-3 py-2 font-mono text-lg tracking-widest select-all">
              {code}
            </code>
            <Button
              variant="outline"
              size="icon"
              aria-label="Copy code"
              onClick={() =>
                void navigator.clipboard
                  ?.writeText(code)
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
        )}
        {paste && (
          // The provider's page returns to the machine Familiar runs on,
          // which no other device can load.
          <form onSubmit={submit} className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">
              It ends on a page that won't load. Copy that page's address from
              the address bar and paste it here.
            </p>
            <div className="flex gap-2">
              <Input
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="http://localhost:…"
                aria-label="Address the sign-in ended on"
                autoComplete="off"
                className="min-w-0 flex-1"
              />
              <Button type="submit" disabled={!address.trim()}>
                Continue
              </Button>
            </div>
          </form>
        )}
        {url && !paste && (
          <p className="text-xs text-muted-foreground">
            Familiar carries on as soon as you're signed in.
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
