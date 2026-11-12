import { AppSettings } from '@/components/app-settings'
import { FamiliarSettings } from '@/components/familiar-settings'
import { NewFamiliarDialog } from '@/components/new-familiar-dialog'
import { NewRoomDialog } from '@/components/new-room-dialog'
import { RoomSettings } from '@/components/room-settings'
import { useOpenDialog } from '@/lib/dialogs'

/**
 * Whichever dialog the URL names over the page. Another page's URL drops it,
 * and a phone's Back closes it.
 */
export const Dialogs = () => {
  const dialog = useOpenDialog()

  switch (dialog?.kind) {
    case 'familiar':
      return <FamiliarSettings key={dialog.id} id={dialog.id} />
    case 'room':
      return <RoomSettings key={dialog.id} id={dialog.id} />
    case 'settings':
      return <AppSettings />
    case 'new-familiar':
      return <NewFamiliarDialog />
    case 'new-room':
      return <NewRoomDialog />
    default:
      return null
  }
}
