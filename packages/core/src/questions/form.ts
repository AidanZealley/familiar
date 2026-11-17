/**
 * The part of MCP's elicitation forms Familiar shows: a flat object of
 * yes/no, text, number and single-choice fields, as the spec limits them.
 * Anything else, such as a multi-select, makes the whole form one Familiar
 * can't show, which the person can only decline.
 */

type Field = {
  /** Its key in the answer. */
  name: string
  title?: string
  description?: string
  required: boolean
}

export type FormField = Field &
  (
    | { type: 'boolean'; default?: boolean }
    | {
        type: 'string'
        default?: string
        minLength?: number
        maxLength?: number
        /** `password` only in a plugin's private question, never a server's. */
        format?: 'email' | 'uri' | 'date' | 'date-time' | 'password'
      }
    | {
        type: 'number' | 'integer'
        default?: number
        minimum?: number
        maximum?: number
      }
    | {
        type: 'choice'
        default?: string
        options: { value: string; label: string }[]
      }
  )

export type Form = FormField[]

/** What the person submits: each field's value by its name. */
export type FormContent = Record<string, string | number | boolean>

const FORMATS = new Set(['email', 'uri', 'date', 'date-time'])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const text = (value: unknown) => (typeof value === 'string' ? value : undefined)
const count = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

/** Drops undefined members, which documents can't store. */
const defined = <T extends object>(value: T) =>
  Object.fromEntries(
    Object.entries(value).filter(([, member]) => member !== undefined),
  ) as T

function fieldOf(name: string, schema: unknown, required: boolean) {
  if (!isRecord(schema)) {
    return undefined
  }
  const base = {
    name,
    title: text(schema.title),
    description: text(schema.description),
    required,
  }
  if (Array.isArray(schema.oneOf) || Array.isArray(schema.enum)) {
    const options = Array.isArray(schema.oneOf)
      ? schema.oneOf.map((option) =>
          isRecord(option) && typeof option.const === 'string'
            ? { value: option.const, label: text(option.title) ?? option.const }
            : undefined,
        )
      : (schema.enum as unknown[]).map((value, index) =>
          typeof value === 'string'
            ? {
                value,
                label:
                  (Array.isArray(schema.enumNames)
                    ? text(schema.enumNames[index])
                    : undefined) ?? value,
              }
            : undefined,
        )
    if (
      schema.type !== 'string' ||
      options.length === 0 ||
      options.some((option) => !option)
    ) {
      return undefined
    }
    return defined<FormField>({
      ...base,
      type: 'choice',
      default: text(schema.default),
      options: options as { value: string; label: string }[],
    })
  }
  switch (schema.type) {
    case 'boolean':
      return defined<FormField>({
        ...base,
        type: 'boolean',
        default:
          typeof schema.default === 'boolean' ? schema.default : undefined,
      })
    case 'string':
      if (schema.format !== undefined && !FORMATS.has(String(schema.format))) {
        return undefined
      }
      return defined<FormField>({
        ...base,
        type: 'string',
        default: text(schema.default),
        minLength: count(schema.minLength),
        maxLength: count(schema.maxLength),
        format: schema.format as 'email' | undefined,
      })
    case 'number':
    case 'integer':
      return defined<FormField>({
        ...base,
        type: schema.type,
        default: count(schema.default),
        minimum: count(schema.minimum),
        maximum: count(schema.maximum),
      })
    default:
      return undefined
  }
}

/** An elicitation's `requestedSchema` as a form, or undefined if Familiar can't show it. */
export function parseForm(schema: unknown): Form | undefined {
  if (
    !isRecord(schema) ||
    schema.type !== 'object' ||
    !isRecord(schema.properties)
  ) {
    return undefined
  }
  const required = new Set(
    Array.isArray(schema.required) ? schema.required : [],
  )
  const fields = Object.entries(schema.properties).map(([name, property]) =>
    fieldOf(name, property, required.has(name)),
  )
  return fields.every((field) => field !== undefined) ? fields : undefined
}

/** Why `content` doesn't fill `form`, or undefined if it does. */
export function formProblem(form: Form, content: unknown): string | undefined {
  if (!isRecord(content)) {
    return 'An answer is an object of field values.'
  }
  const names = new Set(form.map((field) => field.name))
  const extra = Object.keys(content).find((name) => !names.has(name))
  if (extra !== undefined) {
    return `This form has no field ${extra}.`
  }
  for (const field of form) {
    const value = content[field.name]
    const label = field.title ?? field.name
    if (value === undefined) {
      if (field.required) {
        return `${label} is required.`
      }
      continue
    }
    switch (field.type) {
      case 'boolean':
        if (typeof value !== 'boolean') {
          return `${label} is yes or no.`
        }
        break
      case 'choice':
        if (!field.options.some((option) => option.value === value)) {
          return `${label} must be one of its options.`
        }
        break
      case 'string':
        if (
          typeof value !== 'string' ||
          value.length < (field.minLength ?? 0) ||
          value.length > (field.maxLength ?? Infinity)
        ) {
          return `${label} must be text of the right length.`
        }
        break
      default:
        if (
          typeof value !== 'number' ||
          !Number.isFinite(value) ||
          (field.type === 'integer' && !Number.isInteger(value)) ||
          value < (field.minimum ?? -Infinity) ||
          value > (field.maximum ?? Infinity)
        ) {
          return `${label} must be a number in range.`
        }
    }
  }
  return undefined
}
