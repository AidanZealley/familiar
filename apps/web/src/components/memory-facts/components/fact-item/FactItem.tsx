import { HistoryIcon, PinIcon } from 'lucide-react'
import { useState } from 'react'
import { FactMenu } from '@/components/fact-menu'
import { formatDate } from '@/lib/memory'
import { FactEditor } from '../fact-editor'
import { ImportanceDots } from '../importance-dots'
import type { FactItemProps } from './types'

export const FactItem = ({ fact }: FactItemProps) => {
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string>()

  if (editing) {
    return (
      <li className="py-3">
        <FactEditor fact={fact} onDone={() => setEditing(false)} />
      </li>
    )
  }

  return (
    <li className="flex items-start gap-2 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-[0.95rem] leading-snug whitespace-pre-wrap">
          {fact.text}
        </p>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {fact.pinned ? (
            <span className="inline-flex items-center gap-1 text-foreground">
              <PinIcon className="size-3" />
              Pinned
            </span>
          ) : (
            <ImportanceDots importance={fact.importance} />
          )}
          {fact.replaces?.length ? (
            <span className="inline-flex items-center gap-1">
              <HistoryIcon className="size-3" />
              Changed
            </span>
          ) : null}
          <span>Since {formatDate(fact.since)}</span>
        </p>
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
      <FactMenu
        fact={fact}
        onEdit={() => {
          setError(undefined)
          setEditing(true)
        }}
        onError={setError}
      />
    </li>
  )
}
