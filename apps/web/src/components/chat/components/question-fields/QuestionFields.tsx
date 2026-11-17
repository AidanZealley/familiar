import { useId } from 'react'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Switch } from '@/components/ui/switch'
import type { QuestionFieldsProps } from './types'

const INPUT_TYPES = {
  email: 'email',
  uri: 'url',
  date: 'date',
  'date-time': 'datetime-local',
  password: 'password',
} as const

/** A server's form: the fields core can show, each as the person fills it in. */
export const QuestionFields = ({
  form,
  values,
  onChange,
  disabled,
}: QuestionFieldsProps) => {
  const id = useId()
  const set = (name: string, value: string | boolean) =>
    onChange({ ...values, [name]: value })

  return (
    <FieldGroup className="gap-4">
      {form.map((field) => {
        const key = `${id}-${field.name}`
        const label = (
          <>
            {field.title ?? field.name}
            {field.required && <span className="text-muted-foreground">*</span>}
          </>
        )
        const description = field.description && (
          <FieldDescription>{field.description}</FieldDescription>
        )
        switch (field.type) {
          case 'boolean':
            return (
              <Field key={field.name} orientation="horizontal">
                <Switch
                  id={key}
                  checked={values[field.name] === true}
                  onCheckedChange={(checked) => set(field.name, checked)}
                  disabled={disabled}
                />
                <FieldLabel htmlFor={key}>{label}</FieldLabel>
                {description}
              </Field>
            )
          case 'choice':
            return (
              <Field key={field.name}>
                <FieldLabel>{label}</FieldLabel>
                {description}
                <RadioGroup
                  value={String(values[field.name] ?? '')}
                  onValueChange={(value) => set(field.name, String(value))}
                  disabled={disabled}
                >
                  {field.options.map((option) => (
                    <Field key={option.value} orientation="horizontal">
                      <RadioGroupItem
                        value={option.value}
                        id={`${key}-${option.value}`}
                      />
                      <FieldLabel htmlFor={`${key}-${option.value}`}>
                        {option.label}
                      </FieldLabel>
                    </Field>
                  ))}
                </RadioGroup>
              </Field>
            )
          default:
            return (
              <Field key={field.name}>
                <FieldLabel htmlFor={key}>{label}</FieldLabel>
                <Input
                  id={key}
                  value={String(values[field.name] ?? '')}
                  onChange={(event) => set(field.name, event.target.value)}
                  disabled={disabled}
                  required={field.required}
                  {...(field.type === 'string'
                    ? {
                        type: field.format ? INPUT_TYPES[field.format] : 'text',
                        minLength: field.minLength,
                        maxLength: field.maxLength,
                      }
                    : {
                        type: 'number',
                        inputMode:
                          field.type === 'integer' ? 'numeric' : 'decimal',
                        step: field.type === 'integer' ? 1 : 'any',
                        min: field.minimum,
                        max: field.maximum,
                      })}
                />
                {description}
              </Field>
            )
        }
      })}
    </FieldGroup>
  )
}
