import { cn } from 'cn'
import { SearchIcon } from 'lucide-react'
import { useState } from 'react'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group'
import {
  dmOf,
  latestFirst,
  useFamiliars,
  useRooms,
  type NamedRoom,
} from '@/lib/workspace'
import { ArchivedRooms } from './components/archived-rooms'
import { ConnectionStatus } from './components/connection-status'
import { FamiliarRow } from './components/familiar-row'
import { NewMenu } from './components/new-menu'
import { RoomRow } from './components/room-row'
import { SettingsLink } from './components/settings-link'
import type { SidebarProps } from './types'

const heading =
  'px-2 py-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase'

/**
 * Every conversation, from the workspace's stream alone: each Familiar's
 * DM, the named rooms, and archived rooms folded away, each the most
 * recently active first; then the one Settings. The workspace's stream
 * carries every room's latest entry, unread count and turns, so the
 * sidebar opens no room's stream of its own. On a phone it is the home
 * screen, so it takes the page's background to match the browser's chrome.
 */
export const Sidebar = ({ className }: SidebarProps) => {
  const familiars = useFamiliars()
  const rooms = useRooms()
  const [query, setQuery] = useState('')
  const matches = (name: string) =>
    name.toLowerCase().includes(query.trim().toLowerCase())
  const named = latestFirst(
    rooms.filter(
      (room): room is NamedRoom => room.kind === 'room' && matches(room.name),
    ),
    (room) => room.last,
  )
  const dms = latestFirst(
    familiars
      .filter((familiar) => matches(familiar.name))
      .map((familiar) => ({ familiar, dm: dmOf(rooms, familiar.id) })),
    ({ dm }) => dm?.last,
  )
  const open = named.filter((room) => !room.archived)
  const archived = named.filter((room) => room.archived)

  return (
    <nav
      aria-label="Conversations"
      className={cn(
        'flex min-h-0 flex-col bg-background md:bg-sidebar',
        className,
      )}
    >
      <header className="flex h-(--chrome) shrink-0 items-center gap-2 border-b border-border/60 px-3 pt-(--status-bar)">
        <h1 className="flex items-baseline gap-1 font-heading text-sm font-medium tracking-tight">
          <ConnectionStatus />
          familiar
        </h1>
        <NewMenu className="ml-auto" />
      </header>

      <div className="shrink-0 p-3">
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            aria-label="Search conversations"
            placeholder="Search"
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </InputGroup>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        <section aria-label="Familiars" className="flex flex-col pb-2">
          <h2 className={heading}>Familiars</h2>
          {dms.map(({ familiar, dm }) => (
            <FamiliarRow key={familiar.id} familiar={familiar} dm={dm} />
          ))}
        </section>

        {open.length > 0 && (
          <section aria-label="Rooms" className="flex flex-col pb-2">
            <h2 className={heading}>Rooms</h2>
            {open.map((room) => (
              <RoomRow key={room.id} room={room} familiars={familiars} />
            ))}
          </section>
        )}

        {archived.length > 0 && (
          <ArchivedRooms rooms={archived} familiars={familiars} />
        )}

        {query.trim() && !open.length && !archived.length && (
          <p className="px-2 py-4 text-xs text-muted-foreground">
            {dms.length > 0
              ? 'No rooms match.'
              : `Nothing matches “${query.trim()}”.`}
          </p>
        )}
      </div>

      <SettingsLink />
    </nav>
  )
}
