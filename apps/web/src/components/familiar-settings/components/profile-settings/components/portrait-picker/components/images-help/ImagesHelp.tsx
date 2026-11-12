import { CheckIcon, CopyIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { ImagesHelpProps } from './types'

/** Where the owner's portrait images go, and their shape, briefly. */
export const ImagesHelp = ({ folder }: ImagesHelpProps) => {
  const [copied, setCopied] = useState(false)

  return (
    <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
      <p>
        Add 64×32 PNGs, mouth closed then open, to
        {folder ? ':' : ' the avatars folder that familiar status shows.'}
      </p>
      {folder && (
        <div className="flex min-w-0 items-center gap-1 bg-muted py-1 pr-1 pl-2">
          <code className="min-w-0 flex-1 truncate font-mono text-foreground">
            {folder}
          </code>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={copied ? 'Copied' : 'Copy the folder'}
            onClick={() => {
              void navigator.clipboard?.writeText(folder).then(() => {
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              })
            }}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </Button>
        </div>
      )}
    </div>
  )
}
