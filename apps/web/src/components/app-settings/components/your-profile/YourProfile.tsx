import { useMutation } from '@tanstack/react-query'
import { useId, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { workspace } from '@/lib/familiar'
import type { YourProfileProps } from './types'

/** What Familiars call the person, a draft until saved. */
export const YourProfile = ({ me }: YourProfileProps) => {
  const id = useId()
  const [name, setName] = useState(me.name)
  const rename = useMutation({
    mutationFn: () => workspace.me.rename(name.trim()),
  })
  const changed = name.trim() !== me.name

  const submit = (event: FormEvent) => {
    event.preventDefault()
    rename.mutate()
  }

  return (
    <form onSubmit={submit}>
      <FieldGroup className="gap-6">
        <Field>
          <FieldLabel htmlFor={`${id}-name`}>Name</FieldLabel>
          <Input
            id={`${id}-name`}
            value={name}
            autoComplete="name"
            onChange={(event) => setName(event.target.value)}
          />
          <FieldDescription>
            Familiars call you this from your next message.
          </FieldDescription>
        </Field>
        <FieldError>{rename.error?.message}</FieldError>
        <div className="flex gap-2">
          <Button
            type="submit"
            disabled={!changed || !name.trim() || rename.isPending}
          >
            Save
          </Button>
          {changed && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setName(me.name)}
            >
              Discard
            </Button>
          )}
        </div>
      </FieldGroup>
    </form>
  )
}
