import { PlugIcon, ServerIcon } from 'lucide-react'
import { statusOf } from '@/components/connections/status'
import { Badge } from '@/components/ui/badge'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import { Spinner } from '@/components/ui/spinner'
import type { ConnectionTogglesProps } from './types'

/** Every plugin and MCP server, with its tools, its status if it's unwell, and a switch. */
export const ConnectionToggles = ({
  connections,
  toggle,
}: ConnectionTogglesProps) => {
  if (!connections) {
    return <Spinner />
  }
  if (!connections.length) {
    return (
      <p className="text-xs text-muted-foreground">
        No plugins or MCP servers yet. Add a server in Settings › Connections.
      </p>
    )
  }

  return (
    <ItemGroup className="gap-1.5">
      {connections.map((connection) => {
        const status = statusOf(connection)
        return (
          <Item
            key={`${connection.kind}:${connection.name}`}
            variant="outline"
            size="sm"
            className="flex-nowrap"
          >
            <ItemMedia variant="icon">
              {connection.kind === 'plugin' ? <PlugIcon /> : <ServerIcon />}
            </ItemMedia>
            <ItemContent className="min-w-0">
              <ItemTitle className="flex-wrap text-sm">
                {connection.title}
                {status.tone !== 'ok' && (
                  <Badge
                    variant={status.tone === 'bad' ? 'destructive' : 'outline'}
                  >
                    {status.label}
                  </Badge>
                )}
              </ItemTitle>
              <ItemDescription className="font-mono">
                {connection.tools.length
                  ? connection.tools.map((tool) => tool.name).join(', ')
                  : 'Its tools show once it connects.'}
              </ItemDescription>
            </ItemContent>
            <ItemActions>{toggle(connection)}</ItemActions>
          </Item>
        )
      })}
    </ItemGroup>
  )
}
