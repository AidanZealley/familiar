import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field'
import { queryClient } from '@/lib/familiar'
import {
  availableQuery,
  isUpdating,
  reloadFor,
  sourceNames,
  startUpdate,
  updateQuery,
  type UpdateSource,
} from '@/lib/updates'
import { LastUpdate } from './components/last-update'
import { SourceChoice } from './components/source-choice'
import { UpdateProgress } from './components/update-progress'

/**
 * The running version, and updating it from the latest release or the
 * latest build of main. Everything shown comes from the daemon's record of
 * the update, so a reload or another device shows the same; this page only
 * knows it asked for one, until the record shows it started or the wait
 * for it runs out.
 */
export const Updates = () => {
  const { data: info, isError } = useQuery(updateQuery)
  const { data: available } = useQuery(availableQuery)
  const [chosen, setChosen] = useState<UpdateSource>()
  const start = useMutation({
    mutationFn: (source: UpdateSource) =>
      startUpdate(source, info?.last?.startedAt),
    onSuccess: (started) =>
      queryClient.setQueryData(updateQuery.queryKey, started),
  })

  if (!info) {
    return null
  }
  const { installed, service, last } = info
  const starting = start.isPending
  const busy = starting || isUpdating(last)
  const source = chosen ?? installed?.source ?? 'release'
  const target = available?.[source]

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Running</span>
        <span className="font-mono text-sm">
          {installed?.version ?? 'A source checkout'}
        </span>
      </div>

      {!installed ? (
        <p className="border p-3 text-sm text-muted-foreground">
          This Familiar runs from a source checkout. Update it with git and pnpm
          service:install.
        </p>
      ) : !service ? (
        <p className="border p-3 text-sm text-muted-foreground">
          Familiar isn't running as a service, so it can't restart itself. Run
          familiar update in a terminal.
        </p>
      ) : busy ? (
        <UpdateProgress
          update={starting ? undefined : (last ?? undefined)}
          target={available?.[last?.source ?? source]}
          reachable={!isError}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <span className="text-xs text-muted-foreground">Update from</span>
          <SourceChoice
            current={installed.source}
            chosen={source}
            onChoose={setChosen}
            version={installed.version}
            available={available}
          />
          <Button
            className="self-start"
            disabled={target === installed.version || start.isPending}
            onClick={() => start.mutate(source)}
          >
            {target === installed.version
              ? 'Up to date'
              : source !== installed.source
                ? `Switch to the ${sourceNames[source].toLowerCase()} and install ${target ?? 'it'}`
                : target
                  ? `Update to ${target}`
                  : `Update from the ${sourceNames[source].toLowerCase()}`}
          </Button>
          <FieldError>{start.error?.message}</FieldError>
        </div>
      )}

      {last && !busy && (
        <LastUpdate update={last} reloadFor={reloadFor(info)} />
      )}
    </div>
  )
}
