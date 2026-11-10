import { type ModelRef, type ModelThinkingLevel } from '@familiar-ai/client'
import { useMutation, useQuery } from '@tanstack/react-query'
import { BrainIcon, ChevronDownIcon } from 'lucide-react'
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
import { familiar, useFamiliar } from '@/lib/familiar'

const LEVEL_NAMES: Record<ModelThinkingLevel, string> = {
  off: 'Off',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
}

const keyOf = (model: ModelRef) => `${model.provider}/${model.modelId}`

export const ModelPicker = () => {
  // Fixed for the daemon's lifetime, so fetched once rather than mirrored.
  const { data: options } = useQuery({
    queryKey: ['models'],
    queryFn: () => familiar().model.options(),
    staleTime: Infinity,
  })
  // The composer shows their failures; see its `['composer']` key.
  const setModel = useMutation({
    mutationKey: ['composer'],
    mutationFn: (model: ModelRef) => familiar().model.set(model),
  })
  const setLevel = useMutation({
    mutationKey: ['composer'],
    mutationFn: (level: ModelThinkingLevel) =>
      familiar().model.setThinkingLevel(level),
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
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<InputGroupButton size="sm" />}>
          {current.name}
          <ChevronDownIcon />
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

      <DropdownMenu>
        <DropdownMenuTrigger render={<InputGroupButton size="sm" />}>
          <BrainIcon />
          {LEVEL_NAMES[agent.thinkingLevel]}
          <ChevronDownIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" className="w-48">
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
