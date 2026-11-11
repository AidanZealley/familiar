import { useMutation } from '@tanstack/react-query'
import { useId, useState, type FormEvent } from 'react'
import { PixelAvatar } from '@/components/pixel-avatar'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { workspace } from '@/lib/familiar'
import type { ProfileSettingsProps } from './types'

/**
 * Its name, portrait and persona. Edits are a draft until saved; an empty
 * persona saves as the default one, built from the name.
 */
export const ProfileSettings = ({ familiar }: ProfileSettingsProps) => {
  const id = useId()
  const [name, setName] = useState(familiar.name)
  const [persona, setPersona] = useState(familiar.persona ?? '')
  const save = useMutation({
    mutationKey: ['familiar', familiar.id],
    mutationFn: () =>
      workspace.familiars.update(familiar.id, {
        name: name.trim(),
        persona: persona.trim() || null,
      }),
  })
  const changed =
    name.trim() !== familiar.name ||
    (persona.trim() || undefined) !== familiar.persona

  const submit = (event: FormEvent) => {
    event.preventDefault()
    save.mutate()
  }

  return (
    <form onSubmit={submit}>
      <FieldGroup className="gap-6">
        <Field>
          <FieldLabel htmlFor={`${id}-name`}>Name</FieldLabel>
          <Input
            id={`${id}-name`}
            value={name}
            autoComplete="off"
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel>Portrait</FieldLabel>
          <div className="flex items-end gap-3">
            <PixelAvatar familiar={familiar} scale={3} />
            <FieldDescription>
              Picked from its ID, the same on every device.
            </FieldDescription>
          </div>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-persona`}>Persona</FieldLabel>
          <Textarea
            id={`${id}-persona`}
            value={persona}
            placeholder={`The default persona, built from the name “${familiar.name}”. Write one to replace it.`}
            onChange={(event) => setPersona(event.target.value)}
            className="min-h-32 text-sm"
          />
          <FieldDescription>
            Who {familiar.name} is in conversation, used exactly as written, so
            include its name. Leave it empty for the default.
          </FieldDescription>
        </Field>
        <FieldError>{save.error?.message}</FieldError>
        <div className="flex gap-2">
          <Button
            type="submit"
            disabled={!changed || !name.trim() || save.isPending}
          >
            Save
          </Button>
          {changed && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setName(familiar.name)
                setPersona(familiar.persona ?? '')
              }}
            >
              Discard
            </Button>
          )}
        </div>
      </FieldGroup>
    </form>
  )
}
