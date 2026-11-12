import { useMutation } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
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
import { Textarea } from '@/components/ui/textarea'
import { useDialogs } from '@/lib/dialogs'
import { workspace } from '@/lib/familiar'

/** Makes a Familiar with the default tools, then opens its DM. */
export const NewFamiliarDialog = () => {
  const id = useId()
  const navigate = useNavigate()
  const { close: closeDialog } = useDialogs()
  const [name, setName] = useState('')
  const [persona, setPersona] = useState('')
  const create = useMutation({
    mutationFn: () =>
      workspace.familiars.create({
        name: name.trim(),
        ...(persona.trim() && { persona: persona.trim() }),
      }),
    // Closed first, so Back from the new page skips the dialog.
    onSuccess: async (familiar) => {
      await closeDialog()
      await navigate({
        to: '/dm/$familiar',
        params: { familiar: String(familiar) },
      })
    },
  })

  return (
    <FormDialog
      title="New Familiar"
      description="It starts with the default tools and an empty memory. You can change both in its settings."
      canSubmit={!!name.trim() && !create.isPending}
      onSubmit={() => create.mutate()}
      onClose={() => void closeDialog()}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={`${id}-name`}>Name</FieldLabel>
          <Input
            id={`${id}-name`}
            value={name}
            autoComplete="off"
            autoFocus
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-persona`}>Persona</FieldLabel>
          <Textarea
            id={`${id}-persona`}
            value={persona}
            placeholder="Optional: who it is in conversation, including its name."
            onChange={(event) => setPersona(event.target.value)}
            className="min-h-24 text-sm"
          />
          <FieldDescription>
            Leave it empty for the default, built from the name.
          </FieldDescription>
        </Field>
        <FieldError>{create.error?.message}</FieldError>
      </FieldGroup>
    </FormDialog>
  )
}
