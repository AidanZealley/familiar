import { useNavigate } from '@tanstack/react-router'
import { ComputerScreen } from '@/components/computer-screen'
import { StatusDot } from '@/components/status-dot'
import { computerStates, type ComputerStatus as Status } from '@/lib/computers'
import type { ComputerStatusProps } from './types'

/**
 * How the Familiar's computer is, in a line and a sentence: running,
 * asleep, being set up, or unavailable and why. Beside it, its screen,
 * which opens full screen.
 */
export const ComputerStatus = ({
  familiar,
  status,
  error,
}: ComputerStatusProps) => {
  const navigate = useNavigate()
  const state = status && computerStates[status.state]

  return (
    <div className="flex items-start gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-2 font-medium">
          {state && <StatusDot tone={state.tone} />}
          {state?.label ?? 'Checking on it…'}
        </span>
        {status && (
          <p className="text-muted-foreground">
            {describe(status, familiar.name)}
          </p>
        )}
        {error && (
          <p className="text-destructive">
            Couldn't check on it: {error.message}
          </p>
        )}
      </div>
      {(status?.state === 'running' || status?.state === 'asleep') && (
        <button
          type="button"
          aria-label="Open its screen full screen"
          onClick={() =>
            void navigate({
              to: '/dm/$familiar',
              params: { familiar: String(familiar.id) },
              search: { computer: 'full' },
            })
          }
          className="w-40 shrink-0 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:w-28"
        >
          <ComputerScreen familiar={familiar} input={false} />
        </button>
      )}
    </div>
  )
}

const SAFE =
  'It reaches the public internet only, never this machine or your network.'

function describe(status: Status, name: string) {
  switch (status.state) {
    case 'running':
      return `${name} is using it; it sleeps once idle. ${SAFE}`
    case 'asleep':
      return `It wakes when ${name} needs it. ${SAFE}`
    // None yet: its host hasn't made it since the capability came on.
    case 'setting-up':
    case 'none':
      return `It can take a few minutes the first time, while its software downloads. ${SAFE}`
    case 'unavailable':
      return status.reason
  }
}
