import { NoteIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { cn } from 'cn'
import type { ComposerNoticeProps } from './types'

/** A line above the composer: what went wrong, or how the draft will go. */
export const ComposerNotice = ({ tone, children }: ComposerNoticeProps) => {
  const Icon = tone === 'error' ? WarningCircleIcon : NoteIcon
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'mb-2 flex items-start gap-1.5 border px-3 py-2 text-xs backdrop-blur-xl',
        tone === 'error'
          ? 'border-destructive/40 bg-destructive/15 text-destructive dark:bg-destructive/25'
          : 'bg-background/80 text-muted-foreground',
      )}
    >
      <Icon className="mt-px size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  )
}
