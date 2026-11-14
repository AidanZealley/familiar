import type { ModelThinkingLevel } from '@familiar-ai/client'
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
import type { ReasoningSelectProps } from './types'

const LEVEL_NAMES: Record<ModelThinkingLevel, string> = {
  off: 'Off',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
}

/** A reasoning level, picked from the ones a model supports. */
export const ReasoningSelect = ({
  levels,
  value,
  defaultLevel,
  onChange,
  place = 'settings',
  disabled,
}: ReasoningSelectProps) => (
  <DropdownMenu>
    <DropdownMenuTrigger
      render={
        place === 'composer' ? (
          <InputGroupButton size="sm" />
        ) : (
          <Button variant="outline" />
        )
      }
      disabled={disabled}
    >
      <BrainIcon />
      {LEVEL_NAMES[value]}
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
          value={value}
          onValueChange={(level: ModelThinkingLevel) => onChange(level)}
        >
          {levels.map((level) => (
            <DropdownMenuRadioItem key={level} value={level}>
              {LEVEL_NAMES[level]}
              {level === defaultLevel && (
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
