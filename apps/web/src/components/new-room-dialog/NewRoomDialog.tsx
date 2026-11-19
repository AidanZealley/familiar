import { useMutation } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useId, useState } from 'react'
import { FormDialog } from '@/components/form-dialog'
import { PixelAvatar } from '@/components/pixel-avatar'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useDialogs } from '@/lib/dialogs'
import { workspace } from '@/lib/familiar'
import { useFamiliars } from '@/lib/workspace'

/** Makes a named room of some Familiars, then opens it. */
export const NewRoomDialog = () => {
  const id = useId()
  const navigate = useNavigate()
  const { close: closeDialog } = useDialogs()
  const familiars = useFamiliars()
  const [name, setName] = useState('')
  const [members, setMembers] = useState<number[]>([])
  const create = useMutation({
    mutationFn: () =>
      workspace.rooms.create({
        name: name.trim(),
        familiars: members,
      }),
    // Closed first, so Back from the new page skips the dialog.
    onSuccess: async (room) => {
      await closeDialog()
      await navigate({
        to: '/room/$room',
        params: { room: String(room) },
      })
    },
  })
  const toggle = (familiar: number, on: boolean) => {
    setMembers(
      familiars
        .map((each) => each.id)
        .filter((each) => (each === familiar ? on : members.includes(each))),
    )
  }

  return (
    <FormDialog
      title="New room"
      description="Talk to several Familiars at once. You can change who's in it later."
      canSubmit={!!name.trim() && members.length > 0 && !create.isPending}
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
        <FieldSet>
          <FieldLegend variant="label">Familiars</FieldLegend>
          {familiars.map((familiar) => (
            <Field key={familiar.id} orientation="horizontal">
              <Checkbox
                id={`${id}-member-${familiar.id}`}
                checked={members.includes(familiar.id)}
                onCheckedChange={(on) => toggle(familiar.id, on)}
              />
              <FieldLabel
                htmlFor={`${id}-member-${familiar.id}`}
                className="font-normal"
              >
                <PixelAvatar familiar={familiar} />
                {familiar.name}
              </FieldLabel>
            </Field>
          ))}
        </FieldSet>
        <FieldError>{create.error?.message}</FieldError>
      </FieldGroup>
    </FormDialog>
  )
}
