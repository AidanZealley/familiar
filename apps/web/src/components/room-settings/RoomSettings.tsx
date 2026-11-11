import { ArchiveIcon, CrownIcon, SettingsIcon, UsersIcon } from 'lucide-react'
import { RoomAvatar } from '@/components/room-avatar'
import { SettingsDialog } from '@/components/settings-dialog'
import { useFamiliars, useRoomSummary } from '@/lib/workspace'
import { ArchiveRoom } from './components/archive-room'
import { GeneralSettings } from './components/general-settings'
import { LeadSettings } from './components/lead-settings'
import { MembersSettings } from './components/members-settings'
import type { RoomSettingsProps } from './types'

/** A named room's name, members and lead, and archiving it. */
export const RoomSettings = ({ id }: RoomSettingsProps) => {
  const room = useRoomSummary(id)
  const familiars = useFamiliars()

  if (room?.kind !== 'room') {
    return null
  }
  const members = familiars.filter((familiar) =>
    room.familiars.includes(familiar.id),
  )

  return (
    <SettingsDialog
      title={room.name}
      media={<RoomAvatar members={members} />}
      groups={[
        {
          categories: [
            {
              id: 'general',
              label: 'General',
              icon: SettingsIcon,
              keywords: 'name rename',
              content: <GeneralSettings key={room.id} room={room} />,
            },
            {
              id: 'members',
              label: 'Members',
              icon: UsersIcon,
              keywords: 'familiars order add remove',
              description:
                'The Familiars in this room. In an open room, they take turns in this order.',
              content: <MembersSettings room={room} />,
            },
            {
              id: 'lead',
              label: 'Lead',
              icon: CrownIcon,
              keywords: 'open',
              description:
                'A lead answers every message first, and hands off when it helps. Without one the room is open: each Familiar may answer, in turn, or stay quiet.',
              content: <LeadSettings room={room} />,
            },
          ],
        },
        {
          categories: [
            {
              id: 'archive',
              label: room.archived ? 'Archived' : 'Archive',
              icon: ArchiveIcon,
              danger: !room.archived,
              keywords: 'hide close',
              description: room.archived
                ? 'Folded away and closed to new messages; its history is kept.'
                : 'Folds the room away and closes it to new messages, keeping its history. It stays archived.',
              content: <ArchiveRoom room={room} />,
            },
          ],
        },
      ]}
    />
  )
}
