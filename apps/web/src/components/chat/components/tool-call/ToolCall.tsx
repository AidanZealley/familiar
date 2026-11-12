import { WrenchIcon } from '@phosphor-icons/react'
import { Activity } from '../activity'
import { toolLabel } from './label'
import type { ToolCallProps } from './types'

export const ToolCall = ({ call }: ToolCallProps) => (
  <Activity
    icon={<WrenchIcon />}
    label={toolLabel(call.name, call.status)}
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
