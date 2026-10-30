import { MonitorIcon, MoonIcon, SettingsIcon, SunIcon } from 'lucide-react'
import { useTheme } from '@/components/theme-provider'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export const SettingsMenu = () => {
  const { theme, setTheme } = useTheme()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon-lg" aria-label="Settings" />}
      >
        <SettingsIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-40">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Appearance</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={theme}
            onValueChange={(value) => {
              if (value === 'light' || value === 'dark' || value === 'system') {
                setTheme(value)
              }
            }}
          >
            <DropdownMenuRadioItem value="light">
              <SunIcon />
              Light
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">
              <MoonIcon />
              Dark
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system">
              <MonitorIcon />
              System
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
