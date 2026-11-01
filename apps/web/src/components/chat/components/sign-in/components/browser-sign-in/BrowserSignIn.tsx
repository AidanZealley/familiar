import { useFamiliar } from '@familiar-ai/client/react'
import { ArrowLeftIcon, ExternalLinkIcon } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { CancelSignIn } from '../cancel-sign-in'
import type { BrowserSignInProps } from './types'

/**
 * Signing in on the provider's page, one step at a time. The page ends by
 * returning to the machine Familiar runs on, which no other device can load,
 * so the owner brings that last address back here.
 */
export const BrowserSignIn = ({ url, paste }: BrowserSignInProps) => {
  const answerSignIn = useFamiliar((state) => state.account.answerSignIn)
  const [step, setStep] = useState<'open' | 'paste' | 'sent'>('open')
  const [address, setAddress] = useState('')

  if (step === 'sent') {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner />
        Finishing sign-in…
      </p>
    )
  }

  if (step === 'open') {
    return (
      <>
        <div>
          <h2 className="text-sm font-medium">Sign in to ChatGPT</h2>
          <ol className="mt-1 list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
            <li>Open ChatGPT's sign-in page and sign in.</li>
            <li>
              It ends on a page that won't load. That's expected: copy that
              page's address from the address bar.
            </li>
            <li>Come back here and paste it.</li>
          </ol>
        </div>
        <div className="flex gap-2">
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            onClick={() => setStep('paste')}
            className={buttonVariants()}
          >
            Open ChatGPT sign-in
            <ExternalLinkIcon />
          </a>
          <CancelSignIn />
        </div>
      </>
    )
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const text = address.trim()
    if (!text) {
      return
    }
    setStep('sent')
    void answerSignIn(text).catch(() => setStep('paste'))
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-medium">Paste the address</h2>
        <p className="text-xs text-muted-foreground">
          {paste
            ? "Paste the address of the page that wouldn't load. It starts with http://localhost."
            : 'Signed in on this computer? Familiar carries on by itself.'}
        </p>
      </div>
      <Input
        value={address}
        onChange={(event) => setAddress(event.target.value)}
        placeholder="http://localhost:1455/…"
        aria-label="Address of the page that wouldn't load"
        autoComplete="off"
      />
      <div className="flex justify-between gap-2">
        <Button type="button" variant="ghost" onClick={() => setStep('open')}>
          <ArrowLeftIcon />
          Back
        </Button>
        <Button type="submit" disabled={!paste || !address.trim()}>
          Continue
        </Button>
      </div>
    </form>
  )
}
