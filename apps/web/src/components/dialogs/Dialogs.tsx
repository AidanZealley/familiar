import { useRouter } from '@tanstack/react-router'
import { useEffect } from 'react'
import { AppSettings } from '@/components/app-settings'
import { FamiliarSettings } from '@/components/familiar-settings'
import { NewFamiliarDialog } from '@/components/new-familiar-dialog'
import { NewRoomDialog } from '@/components/new-room-dialog'
import { RoomSettings } from '@/components/room-settings'
import { closeDialog, useOpenDialog } from '@/lib/dialogs'

/**
 * Whichever dialog is open over the page. A new page closes it, so a phone's
 * Back never changes the page under an open dialog.
 */
export const Dialogs = () => {
  const router = useRouter()
  const dialog = useOpenDialog()

  useEffect(
    () =>
      router.subscribe(
        'onBeforeNavigate',
        ({ pathChanged }) => pathChanged && closeDialog(),
      ),
    [router],
  )

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
