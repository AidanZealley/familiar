'use client'

import { useId, useState } from 'react'
import { Switch } from 'gencn'
import { defineBlock } from 'gencn/react'
import { useBoundProp } from '@json-render/react'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from '@/components/ui/field'
import { Switch as Toggle } from '@/components/ui/switch'

export const switchBlock = defineBlock(
  Switch,
  function SwitchBlock({ props, bindings, emit }) {
    const id = useId()
    // `checked` bound with $bindState lives in the view's state; otherwise
    // the block keeps its own.
    const path = bindings?.checked
    const [stateValue, writeState] = useBoundProp(props.checked, path)
    const [ownValue, setOwnValue] = useState(props.checked ?? false)
    const checked = (path ? stateValue : ownValue) ?? false

    const toggle = (next: boolean) => {
      if (path) writeState(next)
      else setOwnValue(next)
      // Absolute events for on and off tools, and change for a set tool;
      // a view binds one kind or the other.
      emit(next ? 'turnOn' : 'turnOff')
      emit('change')
    }

    return (
      <Field orientation="horizontal" data-disabled={props.disabled}>
        <FieldContent>
          <FieldLabel htmlFor={id}>{props.label}</FieldLabel>
          {props.description && (
            <FieldDescription>{props.description}</FieldDescription>
          )}
        </FieldContent>
        <Toggle
          id={id}
          checked={checked}
          disabled={props.disabled}
          onCheckedChange={toggle}
        />
      </Field>
    )
  },
)
