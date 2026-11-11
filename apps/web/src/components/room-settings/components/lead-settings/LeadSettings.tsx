import { useMutation } from '@tanstack/react-query'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from '@/components/ui/field'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { workspace } from '@/lib/familiar'
import { nameOf, useFamiliars } from '@/lib/workspace'
import type { LeadSettingsProps } from './types'

/** Who answers what @mentions no one, or no one: an open room. */
export const LeadSettings = ({ room }: LeadSettingsProps) => {
  const familiars = useFamiliars()
  const change = useMutation({
    mutationFn: (lead: number | null) =>
      workspace.rooms.update(room.id, { lead }),
  })
  const value = change.isPending
    ? String(change.variables ?? '')
    : String(room.lead ?? '')

  return (
    <div className="flex flex-col gap-3">
      <RadioGroup
        value={value}
        disabled={room.archived || change.isPending}
        onValueChange={(next: string) =>
          change.mutate(next ? Number(next) : null)
        }
      >
        <FieldLabel>
          <Field orientation="horizontal">
            <RadioGroupItem value="" />
            <FieldContent>
              <FieldTitle>No lead: an open room</FieldTitle>
              <FieldDescription>
                Each Familiar may answer, in member order.
              </FieldDescription>
            </FieldContent>
          </Field>
        </FieldLabel>
        {room.familiars.map((id) => (
          <FieldLabel key={id}>
            <Field orientation="horizontal">
              <RadioGroupItem value={String(id)} />
              <FieldContent>
                <FieldTitle>{nameOf(familiars, id)}</FieldTitle>
                <FieldDescription>
                  Answers anything that @mentions no one. Others answer when it
                  hands off, or when you @mention them.
                </FieldDescription>
              </FieldContent>
            </Field>
          </FieldLabel>
        ))}
      </RadioGroup>
      {change.error && (
        <p className="text-xs text-destructive">{change.error.message}</p>
      )}
    </div>
  )
}
