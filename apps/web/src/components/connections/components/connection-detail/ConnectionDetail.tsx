import { useMutation } from '@tanstack/react-query'
import {
  CaretLeftIcon,
  KeyIcon,
  ArrowClockwiseIcon,
} from '@phosphor-icons/react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { workspace } from '@/lib/familiar'
import { cn } from 'cn'
import { statusOf } from '../../status'
import { StatusDot } from '../status-dot'
import { TransportDetails } from '../transport-details'
import { RemoveServer } from './components/remove-server'
import { ToolList } from './components/tool-list'
import type { ConnectionDetailProps } from './types'

export const ConnectionDetail = ({
  connection,
  onEdit,
  onBack,
}: ConnectionDetailProps) => {
  const status = statusOf(connection)
  const reconnect = useMutation({
    mutationKey: ['connections'],
    mutationFn: () => workspace.mcp.reconnect(connection.name),
  })

  return (
    <section
      aria-label={connection.title}
      className="flex min-w-0 flex-col gap-6"
    >
      <Button
        variant="ghost"
        size="sm"
        className="-mb-3 -ml-2.5 self-start"
        onClick={onBack}
      >
        <CaretLeftIcon />
        Connections
      </Button>
      <header className="flex flex-col gap-3">
        <div className="min-w-0">
          <h2 className="font-heading text-lg font-medium wrap-break-word">
            {connection.title}
          </h2>
          <p className="text-sm text-muted-foreground">
            {connection.kind === 'plugin'
              ? 'Plugin'
              : connection.transport.type === 'http'
                ? 'MCP server over HTTP'
                : 'MCP server run as a local command'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {connection.secrets.length > 0 && (
            <Button variant="outline" onClick={onEdit}>
              <KeyIcon />
              Edit {connection.kind === 'plugin' ? 'keys' : 'token'}
            </Button>
          )}
          {connection.kind === 'mcp' && (
            <>
              <Button
                variant="outline"
                disabled={
                  reconnect.isPending || connection.status.type === 'connecting'
                }
                onClick={() => reconnect.mutate()}
              >
                <ArrowClockwiseIcon
                  className={cn(
                    connection.status.type === 'connecting' && 'animate-spin',
                  )}
                />
                Reconnect
              </Button>
              <RemoveServer connection={connection} />
            </>
          )}
        </div>
      </header>

      <div className="flex flex-col gap-2" aria-live="polite">
        <p className="flex items-center gap-2 text-sm font-medium">
          <StatusDot tone={status.tone} />
          {status.label}
        </p>
        {connection.kind === 'mcp' && connection.status.type === 'failed' && (
          <p className="bg-destructive/10 px-3 py-2 font-mono text-xs break-words text-destructive">
            {connection.status.error}
          </p>
        )}
        {status.advice && (
          <p className="text-sm text-muted-foreground">{status.advice}</p>
        )}
        {reconnect.error && (
          <p role="alert" className="text-sm text-destructive">
            {reconnect.error.message}
          </p>
        )}
      </div>

      {connection.secrets.length > 0 && (
        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-medium">Credentials</h3>
          <ul className="flex flex-col gap-3">
            {connection.secrets.map((secret) => (
              <li key={secret.name} className="flex flex-col gap-1 text-sm">
                <span className="flex items-center gap-2">
                  {secret.label}
                  <Badge variant={secret.set ? 'secondary' : 'outline'}>
                    {secret.set ? 'Set' : 'Not set'}
                  </Badge>
                </span>
                <span className="text-xs text-muted-foreground">
                  Sent only to{' '}
                  <span className="font-mono">{secret.origin}</span>. Never
                  shown again once saved.
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {connection.kind === 'mcp' && (
        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-medium">Server</h3>
          <TransportDetails transport={connection.transport} />
        </section>
      )}
      <ToolList connection={connection} />
    </section>
  )
}
