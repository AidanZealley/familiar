import { useMutation, useQuery } from '@tanstack/react-query'
import { PlusIcon, TrashIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldTitle } from '@/components/ui/field'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from '@/components/ui/item'
import { deleteLogin, loginsQuery, type ComputerLogin } from '@/lib/computers'
import { queryClient } from '@/lib/familiar'
import { LoginForm } from './components/login-form'
import type { ComputerLoginsProps } from './types'

/**
 * The website logins on a Familiar's computer, by site and username: the
 * person adds, replaces and deletes them; passwords are never shown.
 */
export const ComputerLogins = ({ familiar }: ComputerLoginsProps) => {
  const { data: logins, error } = useQuery(loginsQuery(familiar.id))
  // The form open: adding (null) or replacing a login.
  const [editing, setEditing] = useState<ComputerLogin | null>()
  const remove = useMutation({
    mutationFn: (site: string) => deleteLogin(familiar.id, site),
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: ['computer', familiar.id, 'logins'],
      }),
  })

  return (
    <Field>
      <FieldTitle>Logins</FieldTitle>
      <FieldDescription>
        Sites {familiar.name} can sign in to on its computer. It never sees the
        passwords, and can ask you for a login in chat.
      </FieldDescription>
      {!!logins?.length && (
        <ItemGroup className="gap-1.5">
          {logins.map((login) => (
            <Item key={login.site} variant="outline" size="xs">
              <ItemContent>
                <ItemTitle className="font-mono text-sm">
                  {login.site}
                </ItemTitle>
                <ItemDescription>{login.username}</ItemDescription>
              </ItemContent>
              <ItemActions>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditing(login)}
                >
                  Replace
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete the login for ${login.site}`}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(login.site)}
                >
                  <TrashIcon />
                </Button>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      )}
      {(error ?? remove.error) && (
        <p className="text-sm text-destructive">
          {(error ?? remove.error)?.message}
        </p>
      )}
      <div>
        <Button variant="outline" onClick={() => setEditing(null)}>
          <PlusIcon />
          Add a login
        </Button>
      </div>
      {editing !== undefined && (
        <LoginForm
          familiar={familiar}
          login={editing ?? undefined}
          onClose={() => setEditing(undefined)}
        />
      )}
    </Field>
  )
}
