import type { ModelRef } from '@familiar-ai/client'
import { useMutation } from '@tanstack/react-query'
import { CaretDownIcon } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field'
import { workspace } from '@/lib/familiar'
import { keyOf, useModelOptions } from '@/lib/models'
import type { MemoryModelProps } from './types'

const SAME_AS_CHAT = 'same-as-chat'

/**
 * The model this Familiar's nightly memory work runs on. It saves as soon as
 * one is picked and applies from the next night's pass.
 */
export const MemoryModel = ({ familiar }: MemoryModelProps) => {
  const options = useModelOptions()
  const save = useMutation({
    mutationKey: ['familiar', familiar.id],
    mutationFn: (memoryModel: ModelRef | null) =>
      workspace.familiars.update(familiar.id, { memoryModel }),
  })
  // A model that is no longer offered counts as none: upkeep ignores it too.
  const current = options?.find(
    (option) =>
      familiar.memoryModel &&
      keyOf(option.model) === keyOf(familiar.memoryModel),
  )

  if (!options) {
    return null
  }

  return (
    <Field>
      <FieldLabel>Memory model</FieldLabel>
      <FieldDescription>
        What {familiar.name} files and summarises its conversations with, each
        night. A cheaper model can do this well. Applies from the next night.
      </FieldDescription>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="outline" className="self-start" />}
          disabled={save.isPending}
        >
          {current?.name ?? 'Same as chat'}
          <CaretDownIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuRadioGroup
            value={current ? keyOf(current.model) : SAME_AS_CHAT}
            onValueChange={(value: string) =>
              save.mutate(
                options.find((option) => keyOf(option.model) === value)
                  ?.model ?? null,
              )
            }
          >
            <DropdownMenuRadioItem value={SAME_AS_CHAT}>
              Same as chat
            </DropdownMenuRadioItem>
            {options.map((option) => (
              <DropdownMenuRadioItem
                key={keyOf(option.model)}
                value={keyOf(option.model)}
              >
                {option.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <FieldError>{save.error?.message}</FieldError>
    </Field>
  )
}
