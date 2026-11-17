import { useMutation } from '@tanstack/react-query'
import { useId, useState, type FormEvent } from 'react'
import { SettingsFooter } from '@/components/settings-footer'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { computerLimitQuery, setComputerLimit } from '@/lib/computers'
import { queryClient } from '@/lib/familiar'
import type { ComputerLimitProps } from './types'

/** How many computers Familiars may have, a draft until saved. */
export const ComputerLimit = ({ maxComputers }: ComputerLimitProps) => {
  const id = useId()
  const [draft, setDraft] = useState(String(maxComputers))
  const save = useMutation({
    mutationFn: () => setComputerLimit(Number(draft)),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: computerLimitQuery.queryKey }),
  })
  const valid = /^\d+$/.test(draft)
  const changed = valid && Number(draft) !== maxComputers

  const submit = (event: FormEvent) => {
    event.preventDefault()
    save.mutate()
  }

  return (
    <form onSubmit={submit} className="flex flex-1 flex-col">
      <FieldGroup className="flex-1 gap-6">
        <Field>
          <FieldLabel htmlFor={`${id}-max`}>
            Computers Familiars may have
          </FieldLabel>
          <Input
            id={`${id}-max`}
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <FieldDescription>
            In all, across every Familiar. Lowering it removes none; it only
            stops new ones.
          </FieldDescription>
        </Field>
        <FieldError>{save.error?.message}</FieldError>
        <SettingsFooter
          canSave={changed && !save.isPending}
          onDiscard={
            draft !== String(maxComputers)
              ? () => setDraft(String(maxComputers))
              : undefined
          }
        />
      </FieldGroup>
    </form>
  )
}
