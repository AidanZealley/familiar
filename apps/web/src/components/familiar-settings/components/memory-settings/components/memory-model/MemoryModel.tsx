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

// The workspace's memory model, which is the chat's starting model unless
// the host chose another: not whatever this Familiar's chat has switched to.
const DEFAULT = 'default'

/**
 * The model this Familiar's memory filing and consolidation run on. It saves
 * as soon as one is picked and applies from the next call.
 */
export const MemoryModel = ({ familiar }: MemoryModelProps) => {
  const options = useModelOptions()
  const save = useMutation({
    mutationKey: ['familiar', familiar.id],
    mutationFn: (memoryModel: ModelRef | null) =>
      workspace.familiars.update(familiar.id, { memoryModel }),
  })
  // A model that is no longer offered counts as none: memory ignores it too.
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
        night. A cheaper model can do this well. Default is the installation's
        memory model. Applies from the next night.
      </FieldDescription>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="outline" className="self-start" />}
          disabled={save.isPending}
        >
          {current?.name ?? 'Default'}
          <CaretDownIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuRadioGroup
            value={current ? keyOf(current.model) : DEFAULT}
            onValueChange={(value: string) =>
              save.mutate(
                options.find((option) => keyOf(option.model) === value)
                  ?.model ?? null,
              )
            }
          >
            <DropdownMenuRadioItem value={DEFAULT}>
              Default
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
