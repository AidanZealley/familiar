import { useId } from 'react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { PersonSwitcherProps } from './types'

/** Picks whose client sends. Exactly one person is always selected. */
export const PersonSwitcher = ({
  people,
  value,
  onValueChange,
}: PersonSwitcherProps) => {
  const label = useId()
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span id={label} className="text-muted-foreground">
        Send as
      </span>
      <ToggleGroup
        aria-labelledby={label}
        variant="outline"
        size="sm"
        spacing={0}
        value={[value]}
        // Pressing the selected person again would leave nobody selected.
        onValueChange={([id]) => id && onValueChange(id)}
      >
        {people.map((person) => (
          <ToggleGroupItem key={person.id} value={person.id}>
            <Avatar size="sm" className="size-5" aria-hidden>
              <AvatarFallback>{person.name[0]}</AvatarFallback>
            </Avatar>
            {person.name}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}
