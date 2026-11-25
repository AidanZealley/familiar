import type { ToolSettings } from '@familiar-ai/client'
import { CaretRightIcon } from '@phosphor-icons/react'
import {
  useMutation,
  useMutationState,
  useQueryClient,
} from '@tanstack/react-query'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { workspace } from '@/lib/familiar'
import { connectionsQuery } from '../../../../../../query'
import type { ToolRowProps } from './types'

// The MCP hints a tool declares true, in the words the row shows.
const HINTS = [
  { hint: 'readOnlyHint', label: 'Read-only' },
  { hint: 'destructiveHint', label: 'Destructive' },
  { hint: 'idempotentHint', label: 'Idempotent' },
  { hint: 'openWorldHint', label: 'Open world' },
] as const

export const ToolRow = ({ connection, tool }: ToolRowProps) => {
  const queryClient = useQueryClient()
  const mutationKey = [
    'connections',
    connection.kind,
    connection.name,
    tool.name,
  ]
  const settings = useMutation({
    mutationKey,
    scope: { id: JSON.stringify(mutationKey) },
    mutationFn: (change: Partial<ToolSettings>) =>
      workspace.connections.updateToolSettings(
        { name: connection.name, kind: connection.kind },
        tool.name,
        change,
      ),
    onError: (error) =>
      toast.error(`Couldn't save settings for ${tool.name}.`, {
        description: error.message,
      }),
    onSuccess: async (_, change) => {
      // Discard any list fetch that may have read the settings before this save.
      const { queryKey } = connectionsQuery
      await queryClient.cancelQueries({ queryKey, exact: true })
      queryClient.setQueryData(queryKey, (connections) =>
        connections?.map((item) =>
          item.kind === connection.kind && item.name === connection.name
            ? {
                ...item,
                tools: item.tools.map((listed) =>
                  listed.name === tool.name ? { ...listed, ...change } : listed,
                ),
              }
            : item,
        ),
      )
    },
  })

  const pending = useMutationState({
    filters: { mutationKey, exact: true, status: 'pending' },
    select: (mutation) => mutation.state.variables as Partial<ToolSettings>,
  })
  const { enabled, askBeforeRunning, runInBackground } = Object.assign(
    {
      enabled: tool.enabled,
      askBeforeRunning: tool.askBeforeRunning,
      runInBackground: tool.runInBackground,
    },
    ...pending,
  )

  const hints = HINTS.filter(({ hint }) => tool.annotations?.[hint] === true)

  return (
    <li>
      <Collapsible>
        <CollapsibleTrigger className="group/tool flex w-full items-center gap-2 py-2 text-left hover:text-foreground">
          <CaretRightIcon
            aria-hidden
            className="size-3.5 shrink-0 text-muted-foreground group-data-[panel-open]/tool:rotate-90"
          />
          <span className="flex min-w-0 grow flex-col gap-1">
            <span className="min-w-0 font-mono text-sm font-medium wrap-break-word">
              {tool.name}
            </span>
            {hints.length > 0 && (
              <span className="flex flex-wrap gap-1">
                {hints.map(({ hint, label }) => (
                  <Badge
                    key={hint}
                    variant={
                      hint === 'destructiveHint' ? 'destructive' : 'outline'
                    }
                  >
                    {label}
                  </Badge>
                ))}
              </span>
            )}
          </span>
          {!enabled && <Badge variant="outline">Disabled</Badge>}
          {enabled && askBeforeRunning && (
            <span className="shrink-0 text-xs text-muted-foreground">
              Asks first
            </span>
          )}
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-3 pb-2 pl-5.5">
          {tool.description && (
            <p className="text-sm text-muted-foreground">{tool.description}</p>
          )}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-xs">
            <label className="flex items-center gap-2">
              <Checkbox
                aria-label={`Enable ${tool.name}`}
                checked={enabled}
                onCheckedChange={(enabled) => settings.mutate({ enabled })}
              />
              Enabled
            </label>
            <label className="flex items-center gap-2">
              <Checkbox
                aria-label={`Ask first for ${tool.name}`}
                checked={askBeforeRunning}
                onCheckedChange={(askBeforeRunning) =>
                  settings.mutate({ askBeforeRunning })
                }
              />
              Ask first
            </label>
            {connection.kind === 'mcp' && (
              <label className="flex items-center gap-2">
                <Checkbox
                  aria-label={`Run ${tool.name} in background`}
                  checked={runInBackground}
                  onCheckedChange={(runInBackground) =>
                    settings.mutate({ runInBackground })
                  }
                />
                Run in background
              </label>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </li>
  )
}
