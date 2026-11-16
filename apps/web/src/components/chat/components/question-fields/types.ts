import type { Form } from '@familiar-ai/client'

/** What's typed or chosen so far, by field name: text as typed, switches as they are. */
export type FieldValues = Record<string, string | boolean>

export type QuestionFieldsProps = {
  form: Form
  values: FieldValues
  onChange(values: FieldValues): void
  disabled?: boolean
}
