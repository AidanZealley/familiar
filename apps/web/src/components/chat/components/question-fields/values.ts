import type { Form } from '@familiar-ai/client'
import type { FieldValues } from './types'

/** Each field's starting value: its default, else empty or off. */
export const initialValues = (form: Form): FieldValues =>
  Object.fromEntries(
    form.map((field) => [
      field.name,
      field.type === 'boolean'
        ? (field.default ?? false)
        : field.default === undefined
          ? ''
          : String(field.default),
    ]),
  )

/** What to answer with: blanks left out, numbers as numbers. Core checks the rest. */
export const contentOf = (form: Form, values: FieldValues) =>
  Object.fromEntries(
    form.flatMap((field) => {
      const value = values[field.name]
      if (value === undefined || value === '') {
        return []
      }
      return [
        [
          field.name,
          field.type === 'number' || field.type === 'integer'
            ? Number(value)
            : value,
        ],
      ]
    }),
  )
