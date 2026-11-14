import type { ModelRef } from '@familiar-ai/client'
import { CaretDownIcon } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { keyOf } from '@/lib/models'
import type { ModelSelectProps } from './types'

const DEFAULT = 'default'

/**
 * A model, picked from `options`, or else the default it names. A chosen
 * model that's no longer offered counts as none, as it does to the daemon.
 */
export const ModelSelect = ({
  options,
  value,
  fallback,
  onChange,
  disabled,
}: ModelSelectProps) => {
  const named = (model: ModelRef | null | undefined) =>
    model && options.find((option) => keyOf(option.model) === keyOf(model))
  const current = named(value)
  const fallbackOption = named(fallback)
  const defaultLabel = fallbackOption && `Default (${fallbackOption.name})`

  return (
    // Its own box: the field stretches its children, and the menu adds
    // hidden siblings to the trigger that would shift the field's own.
    <div>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="outline" />}
          disabled={disabled}
        >
          {current?.name ?? defaultLabel}
          <CaretDownIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuRadioGroup
            value={current ? keyOf(current.model) : DEFAULT}
            onValueChange={(key: string) =>
              onChange(
                options.find((option) => keyOf(option.model) === key)?.model ??
                  null,
              )
            }
          >
            {defaultLabel && (
              <DropdownMenuRadioItem value={DEFAULT}>
                {defaultLabel}
              </DropdownMenuRadioItem>
            )}
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
    </div>
  )
}
