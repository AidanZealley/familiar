import { useMutationState } from '@tanstack/react-query'
import { ClockCounterClockwiseIcon, PushPinIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { formatDate } from '@/lib/format'
import { FactEditor } from '../fact-editor'
import { FactMenu } from '../fact-menu'
import { ImportanceMeter } from '../importance-meter'
import type { FactItemProps } from './types'

/** A current fact: its text, then how it stands and since when, and its menu. */
export const FactItem = ({ fact }: FactItemProps) => {
  const [editing, setEditing] = useState(false)
  // The latest change to this fact that was refused, from its menu or editor.
  const error = useMutationState({
    filters: { mutationKey: ['fact', fact.id] },
    select: (mutation) => mutation.state.error,
  }).at(-1)
  const failure = error && (
    <p className="mt-1 text-xs text-destructive">{error.message}</p>
  )

  if (editing) {
    return (
      <li>
        <FactEditor fact={fact} onDone={() => setEditing(false)} />
        {failure}
      </li>
    )
  }

  return (
    <li className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <p className="text-sm whitespace-pre-wrap">{fact.text}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {fact.pinned ? (
            <span className="inline-flex items-center gap-1 text-foreground">
              <PushPinIcon weight="fill" className="size-3" />
              Pinned
            </span>
          ) : (
            <ImportanceMeter importance={fact.importance} />
          )}
          <span>Since {formatDate(fact.since)}</span>
          {fact.replaces?.length ? (
            <span className="inline-flex items-center gap-1">
              <ClockCounterClockwiseIcon className="size-3" />
              Changed
            </span>
          ) : null}
        </p>
        {failure}
      </div>
      <FactMenu fact={fact} onEdit={() => setEditing(true)} />
    </li>
  )
}
