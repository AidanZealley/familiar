import { useMutation } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useId, useState } from 'react'
import { PixelAvatar } from '@/components/pixel-avatar'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useDialog } from '@/lib/dialogs'
import { workspace } from '@/lib/familiar'
import { useFamiliars } from '@/lib/workspace'

/** Makes a named room of some Familiars, open or led by one, then opens it. */
export const NewRoomDialog = () => {
  const id = useId()
  const { close } = useDialog()
  const navigate = useNavigate()
  const familiars = useFamiliars()
  const [name, setName] = useState('')
  const [members, setMembers] = useState<number[]>([])
  const [lead, setLead] = useState<number>()
  const create = useMutation({
    mutationFn: () =>
      workspace.rooms.create({
        name: name.trim(),
        familiars: members,
        ...(lead !== undefined && { lead }),
      }),
    // In the dialog's place, so Back returns to the page under it.
    onSuccess: (room) =>
      navigate({
        to: '/room/$room',
        params: { room: String(room) },
        replace: true,
      }),
  })
  const toggle = (familiar: number, on: boolean) => {
    // In the order they're listed, which is the room's turn order.
    setMembers(
      familiars
        .map((each) => each.id)
        .filter((each) => (each === familiar ? on : members.includes(each))),
    )
    if (!on && lead === familiar) {
      setLead(undefined)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-h-[calc(var(--app-height)-2rem)] overflow-y-auto sm:max-w-md">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            create.mutate()
          }}
        >
          <DialogHeader>
            <DialogTitle>New room</DialogTitle>
            <DialogDescription>
              Talk to several Familiars at once. You can change who's in it and
              who leads later.
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
            {members.length > 1 && (
              <FieldSet>
                <FieldLegend variant="label">Lead</FieldLegend>
                <RadioGroup
                  value={String(lead ?? '')}
                  onValueChange={(value: string) =>
                    setLead(value ? Number(value) : undefined)
                  }
                >
                  <Field orientation="horizontal">
                    <RadioGroupItem value="" id={`${id}-open`} />
                    <FieldLabel htmlFor={`${id}-open`} className="font-normal">
                      No lead: each may answer, in turn
                    </FieldLabel>
                  </Field>
                  {familiars
                    .filter((familiar) => members.includes(familiar.id))
                    .map((familiar) => (
                      <Field key={familiar.id} orientation="horizontal">
                        <RadioGroupItem
                          value={String(familiar.id)}
                          id={`${id}-lead-${familiar.id}`}
                        />
                        <FieldLabel
                          htmlFor={`${id}-lead-${familiar.id}`}
                          className="font-normal"
                        >
                          {familiar.name} answers first
                        </FieldLabel>
                      </Field>
                    ))}
                </RadioGroup>
              </FieldSet>
            )}
            <FieldError>{create.error?.message}</FieldError>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!name.trim() || !members.length || create.isPending}
            >
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
