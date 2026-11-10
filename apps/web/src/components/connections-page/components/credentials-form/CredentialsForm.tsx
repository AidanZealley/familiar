import { useMutation } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DrawerClose, DrawerFooter } from '@/components/ui/drawer'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { workspace, queryClient } from '@/lib/familiar'
import { connectionsQuery } from '../../query'
import { TransportDetails } from '../transport-details'
import type { CredentialsFormProps } from './types'

/**
 * Write-only: fields start empty, because the server only says whether a
 * value is set. Saving or removing an MCP token reconnects the server.
 */
export const CredentialsForm = ({
  connection,
  error: initialError,
  onDone,
}: CredentialsFormProps) => {
  const id = useId()
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const changed = connection.secrets.filter((secret) =>
    drafts[secret.name]?.trim(),
  )
  // Each secret's new value, or null to delete it.
  const change = useMutation({
    mutationKey: ['connections'],
    mutationFn: async (secrets: Record<string, string | null>) => {
      for (const [name, value] of Object.entries(secrets)) {
        await (value === null
          ? workspace.connections.deleteSecret(connection, name)
          : workspace.connections.setSecret(connection, name, value))
      }
    },
    // Secrets saved before one failed are still saved, so refresh anyway.
    onError: () =>
      queryClient.invalidateQueries({ queryKey: connectionsQuery.queryKey }),
  })
  const error = change.isIdle ? initialError : change.error?.message

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault()
        change.mutate(
          Object.fromEntries(
            changed.map((secret) => [secret.name, drafts[secret.name].trim()]),
          ),
          { onSuccess: onDone },
        )
      }}
    >
      <FieldGroup className="flex-1 overflow-y-auto p-4">
        {connection.secrets.map((secret) => (
          <Field key={secret.name}>
            <FieldLabel htmlFor={`${id}-${secret.name}`}>
              {secret.label}
              <Badge variant={secret.set ? 'secondary' : 'outline'}>
                {secret.set ? 'Set' : 'Not set'}
              </Badge>
            </FieldLabel>
            <div className="flex gap-2">
              <Input
                id={`${id}-${secret.name}`}
                type="password"
                // Keeps the browser from filling in a saved password.
                autoComplete="new-password"
                spellCheck={false}
                placeholder={secret.set ? 'Enter a new one to replace it' : ''}
                value={drafts[secret.name] ?? ''}
                onChange={(event) =>
                  setDrafts({ ...drafts, [secret.name]: event.target.value })
                }
              />
              {secret.set && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={change.isPending}
                  onClick={() => change.mutate({ [secret.name]: null })}
                >
                  Remove
                </Button>
              )}
            </div>
            <FieldDescription>
              {secret.help && `${secret.help} `}Sent only to{' '}
              <span className="font-mono">{secret.origin}</span>.
            </FieldDescription>
          </Field>
        ))}
        <FieldError>{error}</FieldError>
        {connection.kind === 'mcp' && (
          <>
            <FieldSeparator />
            <TransportDetails transport={connection.transport} />
          </>
        )}
      </FieldGroup>
      <DrawerFooter>
        <Button type="submit" disabled={change.isPending || !changed.length}>
          Save
        </Button>
        <DrawerClose render={<Button variant="outline" />}>Cancel</DrawerClose>
      </DrawerFooter>
    </form>
  )
}
