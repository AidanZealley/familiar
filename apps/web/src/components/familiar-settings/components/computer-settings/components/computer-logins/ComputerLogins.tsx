import type { ComputerLogin } from '@familiar-ai/computer'
import { PlusIcon, TrashIcon } from '@phosphor-icons/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type SubmitEvent } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  deleteComputerLogin,
  loginsQuery,
  saveComputerLogin,
} from '@/lib/computers'
import type { ComputerLoginsProps } from './types'

export const ComputerLogins = ({ familiar }: ComputerLoginsProps) => {
  const query = loginsQuery(familiar.id)
  const { data: logins, error: loadError, isPending } = useQuery(query)
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<ComputerLogin | 'new'>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const openEditor = (login?: ComputerLogin | 'new') => {
    setError(undefined)
    setEditing(login)
  }

  const update = async (operation: () => Promise<void>) => {
    setBusy(true)
    setError(undefined)
    try {
      await operation()
      setEditing(undefined)
      await queryClient.invalidateQueries({ queryKey: query.queryKey })
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Could not update logins.',
      )
    } finally {
      setBusy(false)
    }
  }

  const existing = editing === 'new' ? undefined : editing
  const save = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    void update(() =>
      saveComputerLogin(familiar.id, {
        origin: String(fields.get('origin')),
        username: String(fields.get('username')),
        password: String(fields.get('password')),
      }),
    )
  }

  return (
    <section className="flex flex-col gap-3 border-t pt-6">
      <div className="flex flex-col gap-1">
        <h3 className="font-heading font-medium">Logins</h3>
        <p className="text-muted-foreground">
          Saved website accounts {familiar.name} can use in its browser.
        </p>
      </div>
      {isPending && (
        <p role="status" className="text-muted-foreground">
          Loading logins…
        </p>
      )}
      {logins && (
        <ul className="flex flex-col gap-2">
          {logins.map((login) => (
            <li
              key={`${login.origin} ${login.username}`}
              className="flex flex-wrap items-center justify-between gap-2 border p-3"
            >
              <div className="min-w-0">
                <div className="font-medium break-all">{login.username}</div>
                <div className="break-all text-muted-foreground">
                  {login.origin}
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`Change the password for ${login.username} at ${login.origin}`}
                  disabled={busy}
                  onClick={() => openEditor(login)}
                >
                  Change password
                </Button>
                <AlertDialog
                  onOpenChange={(open) => {
                    if (open) {
                      setError(undefined)
                    }
                  }}
                >
                  <AlertDialogTrigger
                    render={
                      <Button
                        size="icon-sm"
                        variant="destructive"
                        aria-label={`Delete ${login.username} at ${login.origin}`}
                        disabled={busy}
                      />
                    }
                  >
                    <TrashIcon />
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        Delete {login.username} at {login.origin}?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        Removes this saved login from {familiar.name}.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    {error && (
                      <p role="alert" className="text-sm text-destructive">
                        {error}
                      </p>
                    )}
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={busy}>
                        Cancel
                      </AlertDialogCancel>
                      <AlertDialogAction
                        variant="destructive"
                        disabled={busy}
                        onClick={() =>
                          void update(() =>
                            deleteComputerLogin(familiar.id, login),
                          )
                        }
                      >
                        Delete login
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing === undefined && logins && (
        <Button
          className="self-start"
          variant="outline"
          disabled={busy}
          onClick={() => openEditor('new')}
        >
          <PlusIcon />
          Add login
        </Button>
      )}
      {editing !== undefined && (
        <form
          key={existing ? `${existing.origin} ${existing.username}` : 'add'}
          onSubmit={save}
          className="flex flex-col gap-3"
        >
          <label className="flex flex-col gap-1">
            Site
            <Input
              name="origin"
              type="url"
              placeholder="https://github.com"
              defaultValue={existing?.origin}
              readOnly={!!existing}
              required
              autoComplete="off"
            />
          </label>
          <label className="flex flex-col gap-1">
            Username
            <Input
              name="username"
              defaultValue={existing?.username}
              readOnly={!!existing}
              required
              autoComplete="off"
            />
          </label>
          <label className="flex flex-col gap-1">
            Password
            <Input
              name="password"
              type="password"
              required
              autoComplete="new-password"
            />
          </label>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save login'}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => openEditor()}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
      {(error || loadError) && (
        <p role="alert" className="text-destructive">
          {error ?? loadError?.message}
        </p>
      )}
    </section>
  )
}
