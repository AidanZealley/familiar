import { CopyIcon, ExternalLinkIcon } from 'lucide-react'
import { useState } from 'react'
import { Button, buttonVariants } from '@/components/ui/button'
import { CancelSignIn } from '../cancel-sign-in'
import type { DeviceCodeProps } from './types'

/** A code to enter on the provider's page, from any device. */
export const DeviceCode = ({ url, code }: DeviceCodeProps) => {
  const [copied, setCopied] = useState(false)

  return (
    <>
      <div>
        <h2 className="text-sm font-medium">Enter this code on ChatGPT</h2>
        <p className="text-xs text-muted-foreground">
          Open ChatGPT's sign-in page, sign in and enter the code. Familiar
          carries on as soon as you're done.
        </p>
      </div>
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
      <div className="flex gap-2">
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
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
