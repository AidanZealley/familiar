import type { ModelRef } from '@familiar-ai/client'
import { useMutation } from '@tanstack/react-query'
import { CaretDownIcon } from '@phosphor-icons/react'
import { ReasoningPicker } from '@/components/reasoning-picker'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { InputGroupButton } from '@/components/ui/input-group'
import { useFamiliar, useFamiliarStore } from '@/lib/familiar'
import { keyOf, useModelOptions } from '@/lib/models'

/**
 * The model and reasoning level of the nearest Familiar, as two menus in
 * the composer's toolbar. Picking a model gives the Familiar its own, in
 * place of the workspace's default; its settings return it to the default.
 */
export const ModelPicker = () => {
  const familiar = useFamiliarStore()
  const options = useModelOptions()
  // Its failures show under the composer.
  const setModel = useMutation({
    mutationKey: ['composer'],
    mutationFn: (model: ModelRef) => familiar.model.set(model),
  })
  // Live from the conversation, so a change on another device shows here.
  const agent = useFamiliar((state) => state.model)
  const current =
    agent?.model &&
    options?.find((option) => keyOf(option.model) === keyOf(agent.model!))

  if (!current) {
    return null
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<InputGroupButton size="sm" />}>
          {current.name}
          <CaretDownIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" className="w-48">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Model</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={keyOf(current.model)}
              onValueChange={(value: string) => {
                const chosen = options!.find(
                  (option) => keyOf(option.model) === value,
                )
                if (chosen) {
                  setModel.mutate(chosen.model)
                }
              }}
            >
              {options!.map((option) => (
                <DropdownMenuRadioItem
                  key={keyOf(option.model)}
                  value={keyOf(option.model)}
                >
                  {option.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <ReasoningPicker place="composer" />
    </>
  )
}
