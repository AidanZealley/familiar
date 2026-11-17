import { useMutation } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { FormDialog } from '@/components/form-dialog'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { saveLogin } from '@/lib/computers'
import { queryClient } from '@/lib/familiar'
import type { LoginFormProps } from './types'

/**
 * Adds a login to a Familiar's computer, or replaces one, sent straight to
 * the host. The password field starts empty: it's never shown again.
 */
export const LoginForm = ({ familiar, login, onClose }: LoginFormProps) => {
  const id = useId()
  const [site, setSite] = useState(login?.site ?? '')
  const [username, setUsername] = useState(login?.username ?? '')
  const [password, setPassword] = useState('')
  const save = useMutation({
    mutationFn: () =>
      saveLogin(familiar.id, { site: site.trim(), username, password }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['computer', familiar.id, 'logins'],
      })
      onClose()
    },
  })

  return (
    <FormDialog
      title={login ? `Replace the login for ${login.site}` : 'Add a login'}
      description={`${familiar.name} can sign in with it on its computer, only on this site, and never sees the password.`}
      canSubmit={!!site.trim() && !!username && !!password && !save.isPending}
      submitLabel="Save"
      onSubmit={() => save.mutate()}
      onClose={onClose}
    >
      <FieldGroup>
        {!login && (
          <Field>
            <FieldLabel htmlFor={`${id}-site`}>Site</FieldLabel>
            <Input
              id={`${id}-site`}
              placeholder="https://example.com"
              autoComplete="off"
              spellCheck={false}
              value={site}
              onChange={(event) => setSite(event.target.value)}
            />
            <FieldDescription>
              Its exact address: a login for example.com isn't used on
              www.example.com.
            </FieldDescription>
          </Field>
        )}
        <Field>
          <FieldLabel htmlFor={`${id}-username`}>Username or email</FieldLabel>
          <Input
            id={`${id}-username`}
            autoComplete="off"
            spellCheck={false}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-password`}>Password</FieldLabel>
          <Input
            id={`${id}-password`}
            type="password"
            // Keeps the browser from filling in a saved password.
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <FieldError>{save.error?.message}</FieldError>
      </FieldGroup>
    </FormDialog>
  )
}
