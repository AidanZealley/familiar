'use client'

import { useId, useState } from 'react'
import { Slider } from 'gencn'
import { defineBlock } from 'gencn/react'
import { useBoundProp } from '@json-render/react'
import { Field, FieldLabel } from '@/components/ui/field'
import { Slider as Range } from '@/components/ui/slider'

/** Base UI reports one thumb's value as a number or a one-item list. */
const single = (value: number | readonly number[]) =>
  Array.isArray(value) ? (value[0] ?? 0) : (value as number)

export const sliderBlock = defineBlock(
  Slider,
  function SliderBlock({ props, bindings, emit }) {
    const id = useId()
    const min = props.min ?? 0
    const max = props.max ?? 100
    // `value` bound with $bindState lives in the view's state; otherwise the
    // block keeps its own.
    const path = bindings?.value
    const [stateValue, writeState] = useBoundProp(props.value, path)
    const [ownValue, setOwnValue] = useState(props.value ?? min)
    const value = (path ? stateValue : ownValue) ?? min

    const move = (next: number) => (path ? writeState(next) : setOwnValue(next))

    return (
      <Field data-disabled={props.disabled}>
        <div className="flex items-baseline justify-between gap-2">
          <FieldLabel htmlFor={id}>{props.label}</FieldLabel>
          <output
            htmlFor={id}
            className="text-sm text-muted-foreground tabular-nums"
          >
            {value}
            {props.unit}
          </output>
        </div>
        <Range
          id={id}
          min={min}
          max={max}
          step={props.step ?? 1}
          value={[value]}
          disabled={props.disabled}
          onValueChange={(next) => move(single(next))}
          // One change when the person lets go, not one per step of a drag.
          onValueCommitted={() => emit('change')}
        />
      </Field>
    )
  },
)
