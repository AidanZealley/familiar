import { Badge } from '@/components/ui/badge'
import { Field, FieldDescription, FieldTitle } from '@/components/ui/field'
import { computerStates, type ComputerStatus as Status } from '@/lib/computers'
import type { ComputerStatusProps } from './types'

/** How the Familiar's computer is: running, asleep, being set up, or unavailable and why. */
export const ComputerStatus = ({
  familiar,
  status,
  error,
}: ComputerStatusProps) => {
  const description = status && describe(status, familiar.name)

  return (
    <Field>
      <FieldTitle>
        Computer
        {status && (
          <Badge variant={status.state === 'running' ? 'secondary' : 'outline'}>
            {computerStates[status.state].label}
          </Badge>
        )}
      </FieldTitle>
      <FieldDescription>{description ?? 'Checking on it…'}</FieldDescription>
      {error && (
        <FieldDescription className="text-destructive">
          Couldn't check on it: {error.message}
        </FieldDescription>
      )}
    </Field>
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
