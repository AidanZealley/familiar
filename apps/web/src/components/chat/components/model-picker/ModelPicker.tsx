import { type ModelRef, type ModelThinkingLevel } from '@familiar-ai/client'
import { useMutation } from '@tanstack/react-query'
import { BrainIcon, CaretDownIcon } from '@phosphor-icons/react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { InputGroupButton } from '@/components/ui/input-group'
import { useFamiliar, useFamiliarStore } from '@/lib/familiar'
import { keyOf, useModelOptions } from '@/lib/models'
import type { ModelPickerProps } from './types'

const LEVEL_NAMES: Record<ModelThinkingLevel, string> = {
  off: 'Off',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
}

/** The model and reasoning level of the nearest Familiar, as two menus. */
export const ModelPicker = ({ place = 'composer' }: ModelPickerProps) => {
  const familiar = useFamiliarStore()
  const options = useModelOptions()
  // Their failures show where `place` says; see its type.
  const mutationKey = [place === 'composer' ? 'composer' : 'model']
  const setModel = useMutation({
    mutationKey,
    mutationFn: (model: ModelRef) => familiar.model.set(model),
  })
  const setLevel = useMutation({
    mutationKey,
    mutationFn: (level: ModelThinkingLevel) =>
      familiar.model.setThinkingLevel(level),
  })
  const trigger =
    place === 'composer' ? (
      <InputGroupButton size="sm" />
    ) : (
      <Button variant="outline" />
    )
  const content =
    place === 'composer'
      ? ({ side: 'top' } as const)
      : ({ side: 'bottom', align: 'start' } as const)
  // Live from the conversation, so a change on another device shows here.
  const agent = useFamiliar((state) => state.model)
  const current =
    agent?.model &&
    options?.find((option) => keyOf(option.model) === keyOf(agent.model!))

  if (!current || !agent?.thinkingLevel) {
    return null
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={trigger}>
          {current.name}
          <CaretDownIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent {...content} className="w-48">
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

      <DropdownMenu>
        <DropdownMenuTrigger render={trigger}>
          <BrainIcon />
          {LEVEL_NAMES[agent.thinkingLevel]}
          <CaretDownIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent {...content} className="w-48">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Reasoning</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={agent.thinkingLevel}
              onValueChange={(level: ModelThinkingLevel) =>
                setLevel.mutate(level)
              }
            >
              {current.thinkingLevels.map((level) => (
                <DropdownMenuRadioItem key={level} value={level}>
                  {LEVEL_NAMES[level]}
                  {level === current.thinkingLevel && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      Default
                    </span>
                  )}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
