import { ArchiveIcon, GearSixIcon, UsersIcon } from '@phosphor-icons/react'
import { RoomAvatar } from '@/components/room-avatar'
import { SettingsDialog } from '@/components/settings-dialog'
import { useRoomSummary } from '@/lib/workspace'
import { ArchiveRoom } from './components/archive-room'
import { GeneralSettings } from './components/general-settings'
import { MembersSettings } from './components/members-settings'
import type { RoomSettingsProps } from './types'

/** A named room's name, its members and their lead, and archiving it. */
export const RoomSettings = ({ id }: RoomSettingsProps) => {
  const room = useRoomSummary(id)

  if (room?.kind !== 'room') {
    return null
  }
  return (
    <SettingsDialog
      title={room.name}
      media={<RoomAvatar room={room} />}
      groups={[
        {
          categories: [
            {
              id: 'general',
              label: 'General',
              icon: GearSixIcon,
              keywords: 'name rename',
              content: <GeneralSettings key={room.id} room={room} />,
            },
            {
              id: 'members',
              label: 'Members',
              icon: UsersIcon,
              keywords: 'familiars order add remove lead crown open',
              description:
                'The Familiars in this room. Crown one as lead to answer every message that @mentions no one; without a lead the room is open, and they take turns in this order.',
              content: <MembersSettings room={room} />,
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
                ? 'Folded away and closed to new messages; its history is kept. Unarchiving lists it and opens it again.'
                : 'Folds the room away and closes it to new messages, keeping its history, until you unarchive it.',
              content: <ArchiveRoom room={room} />,
            },
          ],
        },
      ]}
    />
  )
}
