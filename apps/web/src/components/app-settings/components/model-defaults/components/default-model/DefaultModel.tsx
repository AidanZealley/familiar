import { ModelSelect } from '@/components/model-select'
import { ReasoningSelect } from '@/components/reasoning-select'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { keyOf } from '@/lib/models'
import type { DefaultModelProps } from './types'

/** One job's default model and reasoning level. */
export const DefaultModel = ({
  label,
  description,
  options,
  value,
  onChange,
  disabled,
}: DefaultModelProps) => {
  const option = options.find((choice) => keyOf(choice.model) === keyOf(value))

  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <FieldDescription>{description}</FieldDescription>
      <div className="flex flex-wrap gap-2">
        <ModelSelect
          options={options}
          value={value}
          onChange={(model) => model && onChange(model)}
          disabled={disabled}
        />
        {option && (
          <ReasoningSelect
            levels={option.thinkingLevels}
            value={value.thinkingLevel}
            defaultLevel={option.thinkingLevel}
            onChange={(thinkingLevel) =>
              onChange({ ...option.model, thinkingLevel })
            }
            disabled={disabled}
          />
        )}
      </div>
    </Field>
  )
}
