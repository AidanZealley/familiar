import type { ModelThinkingLevel } from '@familiar-ai/client'
import { useMutation } from '@tanstack/react-query'
import { BrainIcon, CaretDownIcon } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
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
import type { ReasoningPickerProps } from './types'

const LEVEL_NAMES: Record<ModelThinkingLevel, string> = {
  off: 'Off',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
}

/** The reasoning level of the nearest Familiar's chat, for the model it's on. */
export const ReasoningPicker = ({ place }: ReasoningPickerProps) => {
  const familiar = useFamiliarStore()
  const options = useModelOptions()
  const setLevel = useMutation({
    mutationKey: [place === 'composer' ? 'composer' : 'model'],
    mutationFn: (level: ModelThinkingLevel) =>
      familiar.model.setThinkingLevel(level),
  })
  // Live from the conversation, so a change on another device shows here.
  const agent = useFamiliar((state) => state.model)
  const current =
    agent?.model &&
    options?.find((option) => keyOf(option.model) === keyOf(agent.model!))

  if (!current || !agent?.thinkingLevel) {
    return null
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          place === 'composer' ? (
            <InputGroupButton size="sm" />
          ) : (
            <Button variant="outline" />
          )
        }
      >
        <BrainIcon />
        {LEVEL_NAMES[agent.thinkingLevel]}
        <CaretDownIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={place === 'composer' ? 'top' : 'bottom'}
        align={place === 'composer' ? undefined : 'start'}
        className="w-48"
      >
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
  )
}
