import { CheckIcon } from '@phosphor-icons/react'
import { cn } from 'cn'
import { HourglassSpinner } from '@/components/hourglass-spinner'
import { sourceNames } from '@/lib/updates'
import type { UpdateProgressProps } from './types'

const steps = [
  { phase: 'downloading', label: 'Download' },
  { phase: 'installing', label: 'Install' },
  { phase: 'restarting', label: 'Restart' },
] as const

/** A running update's steps, ticked off as it goes, through the restart. */
export const UpdateProgress = ({
  update,
  target,
  reachable,
}: UpdateProgressProps) => {
  // Unanswered polls mean the daemon is restarting, whatever it last said.
  const phase = reachable ? update?.phase : 'restarting'
  const at = steps.findIndex((step) => step.phase === phase)
  const to = update?.to ?? target
  return (
    <div className="flex flex-col gap-3 border p-3">
      <span className="flex items-center gap-2 text-sm font-medium">
        <HourglassSpinner />
        {!update
          ? 'Starting the update'
          : phase === 'restarting'
            ? 'Restarting Familiar'
            : `Updating to ${to ?? sourceNames[update.source].toLowerCase()}`}
      </span>
      <ol className="flex flex-col gap-1.5 text-sm">
        {steps.map((step, index) => (
          <li
            key={step.phase}
            className={cn(
              'flex items-center gap-2',
              index > at && 'text-muted-foreground',
            )}
          >
            <span className="grid size-4 place-items-center">
              {index < at ? (
                <CheckIcon className="size-3.5" />
              ) : index === at ? (
                <HourglassSpinner className="size-3.5" />
              ) : (
                <span className="size-1.5 bg-current opacity-40" />
              )}
            </span>
            {step.label}
          </li>
        ))}
      </ol>
      <span className="text-xs text-muted-foreground">
        You can close this page; the update carries on.
      </span>
    </div>
  )
}
