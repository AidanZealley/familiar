import { useRouter } from '@tanstack/react-router'
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
import { familiar } from '@/lib/familiar'
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
  const router = useRouter()
  const id = useId()
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(initialError)
  const { setSecret, deleteSecret } = familiar.getState()
  const changed = connection.secrets.filter((secret) =>
    drafts[secret.name]?.trim(),
  )

  const change = async (request: () => Promise<void>) => {
    setBusy(true)
    setError(undefined)
    try {
      await request()
      return true
    } catch (failure) {
      setError((failure as Error).message)
      return false
    } finally {
      setBusy(false)
      await router.invalidate()
    }
  }

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={async (event) => {
        event.preventDefault()
        const saved = await change(async () => {
          for (const secret of changed) {
            await setSecret(connection, secret.name, drafts[secret.name].trim())
          }
        })
        if (saved) {
          onDone()
        }
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
                  disabled={busy}
                  onClick={() =>
                    void change(() => deleteSecret(connection, secret.name))
                  }
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
            <Field>
              <TransportDetails transport={connection.transport} />
              <FieldDescription>
                The name and these settings are fixed. To change them, remove
                the server and add it again.
              </FieldDescription>
            </Field>
          </>
        )}
      </FieldGroup>
      <DrawerFooter>
        <Button type="submit" disabled={busy || !changed.length}>
          Save
        </Button>
        <DrawerClose render={<Button variant="outline" />}>Cancel</DrawerClose>
      </DrawerFooter>
    </form>
  )
}
