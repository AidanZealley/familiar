import { Badge } from '@/components/ui/badge'
import { Field, FieldDescription, FieldTitle } from '@/components/ui/field'
import type { ComputerStatusProps } from './types'

const LABELS = { online: 'Online', asleep: 'Asleep', offline: 'Offline' }

/** Whether the computer is running, and whose network it uses. */
export const ComputerStatus = ({ familiar, computer }: ComputerStatusProps) => {
  const { name } = familiar
  const { status, provided } = computer
  return (
    <Field>
      <FieldTitle>
        Computer
        <Badge variant={status === 'online' ? 'secondary' : 'outline'}>
          {LABELS[status as keyof typeof LABELS]}
        </Badge>
      </FieldTitle>
      <FieldDescription>
        {status === 'asleep'
          ? `It wakes when ${name} needs it. `
          : status === 'offline'
            ? provided
              ? `It couldn't be reached; ${name} will try again when it needs it. `
              : `It isn't connected. Run the agent on the machine to connect it. `
            : ''}
        {provided
          ? `It runs on this host's Docker and reaches the public internet only, never this host or your network.`
          : `It's a machine you paired, so it uses that machine's network and can reach whatever that machine can.`}
      </FieldDescription>
    </Field>
  )
}
