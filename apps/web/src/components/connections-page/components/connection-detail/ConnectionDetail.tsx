import type { ConnectionInfo } from '@familiar-ai/client'
import { Link, useRouter } from '@tanstack/react-router'
import { ChevronLeftIcon, KeyRoundIcon, RefreshCwIcon } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { familiar } from '@/lib/familiar'
import { cn } from '@/lib/utils'
import { statusOf } from '../../status'
import { StatusDot } from '../status-dot'
import { TransportDetails } from '../transport-details'
import { RemoveServer } from './components/remove-server'
import { ToolList } from './components/tool-list'
import type { ConnectionDetailProps } from './types'

/** What the owner can do about the state it's in, if anything. */
function advice(connection: ConnectionInfo) {
  if (connection.kind === 'plugin') {
    return connection.secrets.some((secret) => !secret.set)
      ? 'Set its key so Familiar can use it.'
      : "Installed with Familiar, so it can't be removed here."
  }
  const { status, transport } = connection
  switch (status.type) {
    case 'needs-auth':
      return connection.secrets.some((secret) => secret.set)
        ? 'The server refused the saved token. Replace it to try again.'
        : 'Add its bearer token to connect.'
    case 'disconnected':
      return transport.type === 'stdio'
        ? 'The process exited. Reconnect starts it again.'
        : 'The connection closed. Reconnect to try again.'
    case 'failed':
      return 'Reconnect to try again.'
  }
}

export const ConnectionDetail = ({
  className,
  connection,
  onEdit,
}: ConnectionDetailProps) => {
  const router = useRouter()
  const [reconnecting, setReconnecting] = useState(false)
  const [error, setError] = useState<string>()
  const status = statusOf(connection)
  const hint = advice(connection)

  const reconnect = async () => {
    setReconnecting(true)
    setError(undefined)
    try {
      await familiar.getState().reconnectMcpServer(connection.name)
      await router.invalidate()
    } catch (failure) {
      setError((failure as Error).message)
    }
    setReconnecting(false)
  }

  return (
    <section
      aria-label={connection.title}
      className={cn(
        'flex min-w-0 flex-1 flex-col gap-6 px-4 pt-4 pb-[max(2rem,env(safe-area-inset-bottom))] md:min-h-0 md:overflow-y-auto md:px-8',
        className,
      )}
    >
      <Button
        variant="ghost"
        size="sm"
        className="-mb-3 self-start md:hidden"
        render={<Link to="/connections" search={({ q }) => ({ q })} />}
      >
        <ChevronLeftIcon />
        Connections
      </Button>
      <header className="flex flex-col gap-3">
        <div className="min-w-0">
          <h2 className="font-heading text-2xl font-medium wrap-break-word">
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
              <KeyRoundIcon />
              Edit {connection.kind === 'plugin' ? 'keys' : 'token'}
            </Button>
          )}
          {connection.kind === 'mcp' && (
            <>
              <Button
                variant="outline"
                disabled={
                  reconnecting || connection.status.type === 'connecting'
                }
                onClick={() => void reconnect()}
              >
                <RefreshCwIcon
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
        {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
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
        <>
          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-medium">Server</h3>
            <TransportDetails transport={connection.transport} />
            <p className="text-xs text-muted-foreground">
              {connection.transport.type === 'stdio' &&
                "Runs on this machine as the Familiar service's user. "}
              The name and these settings are fixed. To change them, remove the
              server and add it again.
            </p>
          </section>
          <ToolList connection={connection} />
        </>
      )}
    </section>
  )
}
