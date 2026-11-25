'use client'

import { useId, useState } from 'react'
import { Select } from 'gencn'
import { defineBlock } from 'gencn/react'
import { useBoundProp } from '@json-render/react'
import { Field, FieldLabel } from '@/components/ui/field'
import {
  Select as Picker,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export const selectBlock = defineBlock(
  Select,
  function SelectBlock({ props, bindings, emit }) {
    const id = useId()
    // `value` bound with $bindState lives in the view's state; otherwise the
    // block keeps its own.
    const path = bindings?.value
    const [stateValue, writeState] = useBoundProp(props.value, path)
    const [ownValue, setOwnValue] = useState(props.value ?? null)
    const value = (path ? stateValue : ownValue) ?? null

    const choose = (next: string | null) => {
      if (next === null) return
      if (path) writeState(next)
      else setOwnValue(next)
      emit('change')
    }

    return (
      <Field data-disabled={props.disabled}>
        <FieldLabel htmlFor={id}>{props.label}</FieldLabel>
        {/* `items` lets the trigger show the chosen option's label. */}
        <Picker
          items={props.options}
          value={value}
          disabled={props.disabled}
          onValueChange={choose}
        >
          <SelectTrigger id={id} className="w-full">
            <SelectValue placeholder={props.placeholder ?? 'Choose…'} />
          </SelectTrigger>
          <SelectContent>
            {props.options.map(({ label, value: option }) => (
              <SelectItem key={option} value={option}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Picker>
      </Field>
    )
  },
)
