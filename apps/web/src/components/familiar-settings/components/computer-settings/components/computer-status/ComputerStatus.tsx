import { Badge } from '@/components/ui/badge'
import { Field, FieldDescription, FieldTitle } from '@/components/ui/field'
import type { ComputerStatus as Status } from '@/lib/computers'
import type { ComputerStatusProps } from './types'

/** How the Familiar's computer is: running, asleep, being set up, or unavailable and why. */
export const ComputerStatus = ({
  familiar,
  status,
  error,
}: ComputerStatusProps) => {
  const shown = status && describe(status, familiar.name)

  return (
    <Field>
      <FieldTitle>
        Computer
        {shown && (
          <Badge variant={status.state === 'running' ? 'secondary' : 'outline'}>
            {shown.label}
          </Badge>
        )}
      </FieldTitle>
      <FieldDescription>
        {shown?.description ?? 'Checking on it…'}
      </FieldDescription>
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
      return {
        label: 'Running',
        description: `${name} is using it; it sleeps once idle. ${SAFE}`,
      }
    case 'asleep':
      return {
        label: 'Asleep',
        description: `It wakes when ${name} needs it. ${SAFE}`,
      }
    // None yet: its host hasn't made it since the capability came on.
    case 'setting-up':
    case 'none':
      return {
        label: 'Setting up',
        description: `It can take a few minutes the first time, while its software downloads. ${SAFE}`,
      }
    case 'unavailable':
      return { label: 'Unavailable', description: status.reason }
  }
}
