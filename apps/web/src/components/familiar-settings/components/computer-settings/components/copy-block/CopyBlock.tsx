import { CheckIcon, CopyIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { CopyBlockProps } from './types'

/** Text to copy, such as a command to run. */
export const CopyBlock = ({ text, label }: CopyBlockProps) => {
  const [copied, setCopied] = useState(false)

  return (
    <div className="flex items-start gap-2 rounded-md border bg-muted/50 py-1.5 pr-1.5 pl-3">
      <code className="min-w-0 flex-1 py-0.5 text-xs break-all">{text}</code>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={copied ? 'Copied' : label}
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          })
        }}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
    </div>
  )
}
