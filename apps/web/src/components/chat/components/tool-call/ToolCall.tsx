import { WrenchIcon } from 'lucide-react'
import { Activity } from '../activity'
import type { ToolCallProps } from './types'

const LABEL = {
  running: (name: string) => `Running ${name}…`,
  done: (name: string) => `Used ${name}`,
  error: (name: string) => `${name} failed`,
}

export const ToolCall = ({ call }: ToolCallProps) => (
  <Activity
    icon={<WrenchIcon />}
    label={LABEL[call.status](call.name)}
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
