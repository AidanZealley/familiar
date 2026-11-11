import { useMutation } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useDialog } from '@/lib/dialogs'
import { workspace } from '@/lib/familiar'

/** Makes a Familiar with the default tools, then opens its DM. */
export const NewFamiliarDialog = () => {
  const id = useId()
  const { close } = useDialog()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [persona, setPersona] = useState('')
  const create = useMutation({
    mutationFn: () =>
      workspace.familiars.create({
        name: name.trim(),
        ...(persona.trim() && { persona: persona.trim() }),
      }),
    // In the dialog's place, so Back returns to the page under it.
    onSuccess: (familiar) =>
      navigate({
        to: '/dm/$familiar',
        params: { familiar: String(familiar) },
        replace: true,
      }),
  })

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-md">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            create.mutate()
          }}
        >
          <DialogHeader>
            <DialogTitle>New Familiar</DialogTitle>
            <DialogDescription>
              It starts with the default tools and an empty memory. You can
              change both in its settings.
            </DialogDescription>
          </DialogHeader>
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
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || create.isPending}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
