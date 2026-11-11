import { Link } from '@tanstack/react-router'
import { cn } from 'cn'
import { PixelAvatar } from '@/components/pixel-avatar'
import { dialogSearch, pushedState } from '@/lib/dialogs'
import type { FamiliarPortraitsProps } from './types'

/** A phone's home: the Familiars as a row of portraits, each opening its settings. */
export const FamiliarPortraits = ({
  familiars,
  className,
}: FamiliarPortraitsProps) =>
  familiars.length > 0 && (
    <ul
      aria-label="Familiars' settings"
      className={cn('flex gap-3 overflow-x-auto px-1.5 pt-1 pb-3', className)}
    >
      {familiars.map((familiar) => (
        <li key={familiar.id}>
          <Link
            to="."
            search={dialogSearch({ kind: 'familiar', id: familiar.id })}
            state={(previous) => pushedState(previous)}
            className="flex w-16 flex-col items-center gap-1"
          >
            <PixelAvatar familiar={familiar} scale={2} />
            <span className="w-full truncate text-center text-[11px]">
              {familiar.name}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
