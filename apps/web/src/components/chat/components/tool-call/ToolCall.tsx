import { WrenchIcon } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { useFamiliars } from '@/lib/workspace'
import { handBack, useComputerControl } from '@/lib/computer-control'
import { Activity } from '../activity'
import { toolLabel } from './label'
import type { ToolCallProps } from './types'

/** A computer call waiting for the person to hand the computer back. */
const waitsForPerson = ({ status, details }: ToolCallProps['call']) =>
  status === 'running' &&
  typeof details === 'object' &&
  details !== null &&
  'waiting' in details &&
  details.waiting === true

export const ToolCall = ({ call, familiar }: ToolCallProps) => {
  const id = useFamiliars().find((item) => item.id === familiar)?.id
  const held = useComputerControl(id) === 'held'
  const waiting = waitsForPerson(call)
  return (
    <div className="flex items-start gap-2">
      <Activity
        icon={<WrenchIcon />}
        label={
          waiting
            ? held
              ? 'Waiting for you to hand back the computer'
              : 'Computer in use on another device'
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
      {waiting && held && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => id !== undefined && handBack(id)}
        >
          Hand back
        </Button>
      )}
    </div>
  )
}
