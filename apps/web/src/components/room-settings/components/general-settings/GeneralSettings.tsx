import { useMutation } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { SettingsFooter } from '@/components/settings-footer'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { workspace } from '@/lib/familiar'
import type { GeneralSettingsProps } from './types'

/** The room's name, saved when changed. */
export const GeneralSettings = ({ room }: GeneralSettingsProps) => {
  const id = useId()
  const [name, setName] = useState(room.name)
  const rename = useMutation({
    mutationFn: () => workspace.rooms.update(room.id, { name: name.trim() }),
  })
  const changed = name.trim() !== room.name

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        rename.mutate()
      }}
    >
      <Field>
        <FieldLabel htmlFor={id}>Name</FieldLabel>
        <Input
          id={id}
          value={name}
          autoComplete="off"
          disabled={room.archived}
          onChange={(event) => setName(event.target.value)}
        />
        <FieldError>{rename.error?.message}</FieldError>
      </Field>
      {!room.archived && (
        <SettingsFooter
          canSave={changed && !!name.trim() && !rename.isPending}
          onDiscard={changed ? () => setName(room.name) : undefined}
        />
      )}
    </form>
  )
}
