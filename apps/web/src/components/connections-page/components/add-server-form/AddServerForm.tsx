import { useFamiliar } from '@familiar-ai/client/react'
import type { McpServer } from '@familiar-ai/client'
import { useRouter } from '@tanstack/react-router'
import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { DrawerClose, DrawerFooter } from '@/components/ui/drawer'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import type { AddServerFormProps } from './types'

type Errors = Partial<Record<'name' | 'url' | 'command' | 'form', string>>

/**
 * Checks what the owner can fix field by field; the server checks the rest,
 * and its reason shows below the form.
 */
function read(
  form: FormData,
  type: 'http' | 'stdio',
  auth: 'none' | 'bearer',
): { server: McpServer } | { errors: Errors } {
  const text = (key: string) => String(form.get(key) ?? '').trim()
  const name = text('name')
  const transport: McpServer['transport'] =
    type === 'http'
      ? { type, url: text('url'), auth: { type: auth } }
      : {
          type,
          command: text('command'),
          args: String(form.get('args') ?? '')
            .split(/\r?\n/)
            .filter((arg) => arg !== ''),
        }
  const errors: Errors = {}
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(name)) {
    errors.name =
      'Start with a lowercase letter, then use lowercase letters, digits and hyphens, up to 32.'
  }
  if (transport.type === 'http' && !URL.canParse(transport.url)) {
    errors.url =
      'Enter a full address, such as http://homeassistant.local:8123/api/mcp.'
  }
  if (transport.type === 'stdio' && !transport.command) {
    errors.command = 'Enter the program to run.'
  }
  return Object.keys(errors).length
    ? { errors }
    : { server: { name, transport } }
}

export const AddServerForm = ({ onAdded }: AddServerFormProps) => {
  const addServer = useFamiliar((state) => state.mcp.add)
  const setSecret = useFamiliar((state) => state.connections.setSecret)
  const router = useRouter()
  const id = useId()
  const [transport, setTransport] = useState<'http' | 'stdio'>('http')
  const [auth, setAuth] = useState<'none' | 'bearer'>('none')
  const [errors, setErrors] = useState<Errors>({})
  const [busy, setBusy] = useState(false)

  const add = async (form: FormData) => {
    const result = read(form, transport, auth)
    if ('errors' in result) {
      setErrors(result.errors)
      return
    }
    const { server } = result
    setErrors({})
    setBusy(true)
    try {
      await addServer(server)
    } catch (failure) {
      setErrors({ form: (failure as Error).message })
      setBusy(false)
      return
    }
    // The server exists now, so a failed token is retried from Edit, not here.
    const token = String(form.get('token') ?? '').trim()
    let tokenError: string | undefined
    if (token) {
      try {
        await setSecret({ kind: 'mcp', name: server.name }, 'token', token)
      } catch (failure) {
        tokenError = `${server.name} was added, but its token wasn't saved: ${(failure as Error).message}`
      }
    }
    await router.invalidate()
    await onAdded(server.name, tokenError)
  }

  const field = (key: keyof Errors) => ({
    'data-invalid': Boolean(errors[key]) || undefined,
  })
  const input = (key: keyof Errors) => ({
    id: `${id}-${key}`,
    name: key,
    autoComplete: 'off',
    spellCheck: false,
    'aria-invalid': Boolean(errors[key]) || undefined,
  })

  return (
    <form
      noValidate
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault()
        void add(new FormData(event.currentTarget))
      }}
    >
      <FieldGroup className="flex-1 overflow-y-auto p-4">
        <Field {...field('name')}>
          <FieldLabel htmlFor={`${id}-name`}>Name</FieldLabel>
          <Input
            {...input('name')}
            className="font-mono"
            placeholder="home-assistant"
          />
          <FieldDescription>
            Used in its tools' names, and can't be changed later.
          </FieldDescription>
          <FieldError>{errors.name}</FieldError>
        </Field>
        <FieldSet>
          <FieldLegend variant="label">Runs</FieldLegend>
          <RadioGroup value={transport} onValueChange={setTransport}>
            <Field orientation="horizontal">
              <RadioGroupItem value="http" id={`${id}-http`} />
              <FieldLabel htmlFor={`${id}-http`}>Over HTTP</FieldLabel>
            </Field>
            <Field orientation="horizontal">
              <RadioGroupItem value="stdio" id={`${id}-stdio`} />
              <FieldLabel htmlFor={`${id}-stdio`}>
                As a command on this machine
              </FieldLabel>
            </Field>
          </RadioGroup>
        </FieldSet>
        {transport === 'http' ? (
          <>
            <Field {...field('url')}>
              <FieldLabel htmlFor={`${id}-url`}>URL</FieldLabel>
              <Input
                {...input('url')}
                type="url"
                inputMode="url"
                className="font-mono"
                placeholder="http://homeassistant.local:8123/api/mcp"
              />
              <FieldDescription>
                Local, LAN and tailnet addresses work.
              </FieldDescription>
              <FieldError>{errors.url}</FieldError>
            </Field>
            <FieldSet>
              <FieldLegend variant="label">Sign-in</FieldLegend>
              <RadioGroup value={auth} onValueChange={setAuth}>
                <Field orientation="horizontal">
                  <RadioGroupItem value="none" id={`${id}-none`} />
                  <FieldLabel htmlFor={`${id}-none`}>None</FieldLabel>
                </Field>
                <Field orientation="horizontal">
                  <RadioGroupItem value="bearer" id={`${id}-bearer`} />
                  <FieldLabel htmlFor={`${id}-bearer`}>Bearer token</FieldLabel>
                </Field>
              </RadioGroup>
            </FieldSet>
            {auth === 'bearer' && (
              <Field>
                <FieldLabel htmlFor={`${id}-token`}>Token</FieldLabel>
                <Input
                  id={`${id}-token`}
                  name="token"
                  type="password"
                  autoComplete="new-password"
                  spellCheck={false}
                  placeholder="Optional: you can add it later"
                />
                <FieldDescription>
                  Sent only to this URL, and never shown again.
                </FieldDescription>
              </Field>
            )}
          </>
        ) : (
          <>
            <Field {...field('command')}>
              <FieldLabel htmlFor={`${id}-command`}>Command</FieldLabel>
              <Input
                {...input('command')}
                className="font-mono"
                placeholder="uvx"
              />
              <FieldDescription>
                Runs as the Familiar service's user. Prefer an absolute path.
              </FieldDescription>
              <FieldError>{errors.command}</FieldError>
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-args`}>Arguments</FieldLabel>
              <Textarea
                id={`${id}-args`}
                name="args"
                rows={3}
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
                placeholder="mcp-server-time"
              />
              <FieldDescription>
                One per line, passed as they are without a shell. They're saved
                and shown here, so keep secrets out of them.
              </FieldDescription>
            </Field>
          </>
        )}
        <FieldError>{errors.form}</FieldError>
      </FieldGroup>
      <DrawerFooter>
        <Button type="submit" disabled={busy}>
          Add server
        </Button>
        <DrawerClose render={<Button variant="outline" />}>Cancel</DrawerClose>
      </DrawerFooter>
    </form>
  )
}
