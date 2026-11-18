import { WrenchIcon } from '@phosphor-icons/react'
import { Activity } from '../activity'
import { toolLabel } from './label'

/** A computer call waiting for the person to hand the computer back. */
const waitsForPerson = ({ status, details }: ToolCallProps['call']) =>
  status === 'running' &&
  typeof details === 'object' &&
  details !== null &&
  'waiting' in details &&
  details.waiting === true
import type { ToolCallProps } from './types'

export const ToolCall = ({ call }: ToolCallProps) => (
  <Activity
    icon={<WrenchIcon />}
    label={
      waitsForPerson(call)
        ? 'Waiting for you to hand back the computer'
        : toolLabel(call.name, call.status)
    }
    active={call.status === 'running'}
    failed={call.status === 'error'}
  >
    <pre className="whitespace-pre-wrap text-muted-foreground">
      {JSON.stringify(call.arguments, null, 2)}
    </pre>
    {call.output && (
      <pre className="max-h-64 overflow-y-auto border-t pt-2 whitespace-pre-wrap">
        {call.output}
      </pre>
    )}
  </Activity>
)
