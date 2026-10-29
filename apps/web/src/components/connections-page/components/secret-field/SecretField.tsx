import { useRouter } from '@tanstack/react-router'
import { CheckIcon } from 'lucide-react'
import { useId, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { familiar } from '@/lib/familiar'
import type { SecretFieldProps } from './types'

/**
 * Write-only: the field starts empty and empties again once saved, because
 * the server never returns a value, only whether one is set.
 */
export const SecretField = ({ connection, secret }: SecretFieldProps) => {
  const router = useRouter()
  const id = useId()
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const change = async (request: () => Promise<void>) => {
    setBusy(true)
    setError(undefined)
    try {
      await request()
      setDraft('')
      // Reloads the list, so the field shows whether it's set.
      await router.invalidate()
    } catch (failure) {
      setError((failure as Error).message)
    }
    setBusy(false)
  }

  const value = draft.trim()
  const { setSecret, deleteSecret } = familiar.getState()

  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(event) => {
        event.preventDefault()
        if (value) {
          void change(() => setSecret(connection, secret.name, value))
        }
      }}
    >
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="text-sm">
          {secret.label}
        </label>
        {secret.set ? (
          <Badge variant="secondary">
            <CheckIcon />
            Set
          </Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            Not set
          </Badge>
        )}
      </div>
      {secret.help && (
        <p className="text-xs text-muted-foreground">{secret.help}</p>
      )}
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="password"
          // Keeps the browser from filling in a saved password.
          autoComplete="new-password"
          spellCheck={false}
          placeholder={secret.set ? 'Enter a new one to replace it' : ''}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className="flex-1"
        />
        <Button type="submit" disabled={busy || !value}>
          Save
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy || !secret.set}
          onClick={() =>
            void change(() => deleteSecret(connection, secret.name))
          }
        >
          Clear
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Sent only to <span className="font-mono">{secret.origin}</span>
      </p>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </form>
  )
}
