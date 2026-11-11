import { PixelAvatar } from '@/components/pixel-avatar'
import type { MentionMenuProps } from './types'

/**
 * Above the composer while an `@name` is typed in a room: picking one makes
 * it a mention, which addresses that Familiar. Tab or Enter picks the first.
 */
export const MentionMenu = ({ familiars, onPick }: MentionMenuProps) => (
  <ul
    aria-label="Mention a Familiar"
    className="absolute bottom-full left-4 z-10 mb-1 flex w-56 flex-col border bg-popover p-1 text-popover-foreground shadow-md"
  >
    {familiars.map((familiar) => (
      <li key={familiar.id}>
        <button
          type="button"
          // Keeps the textarea focused, and the phone's keyboard up.
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => onPick(familiar)}
          className="flex w-full items-center gap-2 px-1.5 py-1 text-left text-sm hover:bg-muted"
        >
          <PixelAvatar familiar={familiar} />
          <span className="truncate">{familiar.name}</span>
        </button>
      </li>
    ))}
  </ul>
)
