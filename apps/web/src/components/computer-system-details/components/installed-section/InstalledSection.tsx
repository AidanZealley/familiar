import { FileCodeIcon, PackageIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { formatAgo } from '@/lib/format'
import { DetailSection } from '../detail-section'
import type { InstalledSectionProps } from './types'

const SHOWN = 5

const packages = (count: number) => `${count} package${count === 1 ? '' : 's'}`

/**
 * What's installed on the computer beyond its image, which comes back when
 * it's made again from a newer one: the packages, the first few until
 * asked for all, its setup script, and how the last restore went.
 */
export const InstalledSection = ({
  installed,
  restored,
}: InstalledSectionProps) => {
  const [all, setAll] = useState(false)
  const shown = all ? installed.packages : installed.packages.slice(0, SHOWN)
  const done =
    restored &&
    [
      restored.installed.length &&
        `${packages(restored.installed.length)} reinstalled`,
      restored.setup === 'ran' && 'setup.sh ran',
    ]
      .filter(Boolean)
      .join(', ')
  const problems =
    restored &&
    [
      restored.missed.length &&
        `Couldn't reinstall ${restored.missed.join(', ')}.`,
      restored.setup === 'failed' && 'setup.sh failed.',
      (restored.setup === 'stopped' || restored.stopped) &&
        'Stopped at its time limit.',
    ].filter(Boolean)

  return (
    <DetailSection title="Installed" icon={PackageIcon}>
      {restored && (
        <li className="text-muted-foreground">
          Restored {formatAgo(Date.parse(restored.at))}
          {done && `: ${done}`}
        </li>
      )}
      {!!problems?.length && (
        <li className="text-destructive">
          {problems.join(' ')}{' '}
          <span className="text-muted-foreground">
            See <span className="font-mono">~/.familiar/restore.log</span>.
          </span>
        </li>
      )}
      {!installed.packages.length && !installed.setup && (
        <li className="text-muted-foreground">
          Nothing beyond what every computer has.
        </li>
      )}
      {shown.map((pkg) => (
        <li key={pkg.name} className="flex min-w-0 flex-col">
          <span className="truncate font-mono">{pkg.name}</span>
          {pkg.summary && (
            <span className="truncate text-muted-foreground">
              {pkg.summary}
            </span>
          )}
        </li>
      ))}
      {installed.packages.length > SHOWN && (
        <li>
          <button
            type="button"
            onClick={() => setAll(!all)}
            className="text-muted-foreground hover:text-foreground"
          >
            {all ? 'Show fewer' : `Show all ${installed.packages.length}`}
          </button>
        </li>
      )}
      {installed.setup && (
        <li className="flex min-w-0 items-center gap-1.5">
          <FileCodeIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="shrink-0 font-mono">~/.familiar/setup.sh</span>
          <span className="truncate text-muted-foreground">
            runs after each update
          </span>
        </li>
      )}
    </DetailSection>
  )
}
