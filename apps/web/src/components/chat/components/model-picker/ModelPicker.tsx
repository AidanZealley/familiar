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
  const modelOptions = useFamiliar((state) => state.conversation.modelOptions)
  const setModel = useFamiliar((state) => state.conversation.setModel)
  const setThinkingLevel = useFamiliar(
    (state) => state.conversation.setThinkingLevel,
  )
  // Fixed for each store's daemon lifetime, so fetched rather than mirrored.
  const [options, setOptions] = useState<ModelOption[]>()
  useEffect(() => {
    let active = true
    void modelOptions().then((options) => {
      if (active) {
        setOptions(options)
      }
    })
    return () => {
      active = false
    }
  }, [modelOptions])
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
                  void setModel(chosen.model)
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
                void setThinkingLevel(level)
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
