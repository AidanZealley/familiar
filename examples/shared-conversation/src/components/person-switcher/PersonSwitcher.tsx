import { useId } from 'react'
import { PersonAvatar } from '@/components/person-avatar'
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
          // Even padding around the avatar, top, bottom and start.
          <ToggleGroupItem
            key={person.id}
            value={person.id}
            className="h-auto gap-1.5 py-1.5 ps-1.5 pe-2.5"
          >
            <PersonAvatar author={person} />
            {person.name}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}
