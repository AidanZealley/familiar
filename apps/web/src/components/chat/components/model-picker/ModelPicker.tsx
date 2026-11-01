import {
  agentOf,
  type ModelOption,
  type ModelRef,
  type ModelThinkingLevel,
} from '@familiar-ai/client'
import { BrainIcon, ChevronDownIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
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
import { useFamiliar } from '@familiar-ai/client/react'
import { familiar } from '@/lib/familiar'

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
  const [options, setOptions] = useState<ModelOption[]>()
  useEffect(() => {
    void familiar.getState().conversation.modelOptions().then(setOptions)
  }, [])
  // Live from the conversation, so a change on another device shows here.
  const agent = useFamiliar((state) => agentOf(state.conversation.view))
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
                  void familiar.getState().conversation.setModel(chosen.model)
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
                void familiar.getState().conversation.setThinkingLevel(level)
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
