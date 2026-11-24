import { BrowsersIcon, CpuIcon } from '@phosphor-icons/react'
import { useQuery } from '@tanstack/react-query'
import { HourglassSpinner } from '@/components/hourglass-spinner'
import type { Usage } from '@familiar-ai/computer'
import {
  computerDetailQuery,
  describeCall,
  programsByName,
} from '@/lib/computers'
import { formatAgo, formatBytes } from '@/lib/format'
import { DetailSection } from './components/detail-section'
import { InstalledSection } from './components/installed-section'
import { UsageMeter } from './components/usage-meter'
import type { ComputerSystemDetailsProps } from './types'

const PROGRAMS_SHOWN = 5

/** An amount in words, against its limit if it has one: `512 MB of 4 GB`. */
const amount = (
  { used, limit }: Usage,
  format: (value: number) => string = String,
) => (limit ? `${format(used)} of ${format(limit)}` : format(used))

/**
 * A Familiar's computer in detail, read only while this is shown: what it's
 * doing, when it started or slept, what it's using, its tabs, programs,
 * what's installed beyond its image, and its system. Only what its host reported appears: a host that can't tell
 * something, or a sleeping computer, simply shows less.
 */
export const ComputerSystemDetails = ({
  familiar,
  status,
}: ComputerSystemDetailsProps) => {
  const {
    data: detail,
    error,
    isPending,
  } = useQuery(computerDetailQuery(familiar.id))
  const current = detail?.status ?? status
  const programs =
    detail?.programs && programsByName(detail.programs).slice(0, PROGRAMS_SHOWN)
  const when = [
    detail?.since &&
      `${current?.state === 'asleep' ? 'Went to sleep' : 'Started'} ${formatAgo(Date.parse(detail.since))}`,
    detail?.lastUsed && `last used ${formatAgo(Date.parse(detail.lastUsed))}`,
  ]
    .filter(Boolean)
    .join(', ')
  const system = [detail?.system?.os, detail?.system?.architecture]
    .filter(Boolean)
    .join(' · ')

  if (isPending) {
    return (
      <span
        role="status"
        className="flex items-center gap-2 text-muted-foreground"
      >
        <HourglassSpinner />
        Loading its details…
      </span>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      {detail?.doing?.map((call, index) => (
        <p key={index} className="shimmer truncate">
          {describeCall(call)}
        </p>
      ))}
      {when && <p className="text-muted-foreground">{when}</p>}
      {(detail?.cpu || detail?.memory || detail?.processes || detail?.disk) && (
        <div className="flex flex-col gap-2">
          {detail.cpu && (
            <UsageMeter
              label="CPU"
              usage={detail.cpu}
              value={
                detail.cpu.limit
                  ? `${Math.round((detail.cpu.used / detail.cpu.limit) * 100)}% of ${detail.cpu.limit} CPUs`
                  : `${Math.round(detail.cpu.used * 100)}%`
              }
            />
          )}
          {detail.memory && (
            <UsageMeter
              label="Memory"
              usage={detail.memory}
              value={amount(detail.memory, formatBytes)}
            />
          )}
          {detail.processes && (
            <UsageMeter
              label="Processes"
              usage={detail.processes}
              value={amount(detail.processes)}
            />
          )}
          {detail.disk && (
            <UsageMeter
              label="Disk"
              usage={detail.disk}
              value={amount(detail.disk, formatBytes)}
            />
          )}
        </div>
      )}
      {!!detail?.tabs?.length && (
        <DetailSection title="Tabs" icon={BrowsersIcon}>
          {detail.tabs.map((tab, index) => (
            <li key={index} className="flex min-w-0 flex-col">
              <span className="truncate">{tab.title || tab.url}</span>
              {tab.title && (
                <span className="truncate text-muted-foreground">
                  {tab.url}
                </span>
              )}
            </li>
          ))}
        </DetailSection>
      )}
      {!!programs?.length && (
        <DetailSection title="Programs" icon={CpuIcon}>
          {programs.map((program) => (
            <li
              key={program.name}
              className="flex min-w-0 justify-between gap-2"
            >
              <span className="truncate font-mono">
                {program.name}
                {program.count > 1 && (
                  <span className="text-muted-foreground">
                    {' '}
                    ×{program.count}
                  </span>
                )}
              </span>
              {program.memory !== undefined && (
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {formatBytes(program.memory)}
                </span>
              )}
            </li>
          ))}
        </DetailSection>
      )}
      {detail?.installed && (
        <InstalledSection
          installed={detail.installed}
          restored={detail.restored}
        />
      )}
      {system && <p className="text-muted-foreground">{system}</p>}
      {error && (
        <p className="text-destructive">Couldn't look at it: {error.message}</p>
      )}
    </div>
  )
}
