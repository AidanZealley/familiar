import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react'
import {
  Field,
  FieldContent,
  FieldLabel,
  FieldTitle,
} from '@/components/ui/field'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useTheme, type Theme } from '@/lib/theme'

const themes = [
  { value: 'system', label: 'System', icon: MonitorIcon },
  { value: 'light', label: 'Light', icon: SunIcon },
  { value: 'dark', label: 'Dark', icon: MoonIcon },
] as const

export const AppearanceSettings = () => {
  const { theme, setTheme } = useTheme()

  return (
    <RadioGroup
      value={theme}
      onValueChange={(value: Theme) => setTheme(value)}
      className="sm:grid-cols-3"
    >
      {themes.map(({ value, label, icon: Icon }) => (
        <FieldLabel key={value}>
          <Field orientation="horizontal">
            <RadioGroupItem value={value} />
            <FieldContent>
              <FieldTitle>
                <Icon className="size-4" />
                {label}
              </FieldTitle>
            </FieldContent>
          </Field>
        </FieldLabel>
      ))}
    </RadioGroup>
  )
}
