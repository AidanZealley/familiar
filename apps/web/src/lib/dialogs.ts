import { create } from 'zustand'

/** A dialog over the page. */
export type DialogRef =
  | { kind: 'familiar'; id: number }
  | { kind: 'room'; id: number }
  | { kind: 'settings' }
  | { kind: 'new-familiar' }
  | { kind: 'new-room' }

type OpenDialog = {
  dialog: DialogRef
  /** The category to show first, for an opener that names one. */
  category?: string
}

/**
 * The one dialog open over the page, if any. Plain app state: it isn't in
 * the URL, and `Dialogs` closes it when the page underneath changes.
 */
const useDialogs = create<{ open?: OpenDialog }>(() => ({}))

export const openDialog = (dialog: DialogRef, category?: string) =>
  useDialogs.setState({ open: { dialog, category } })

export const closeDialog = () => useDialogs.setState({ open: undefined })

export const useOpenDialog = () => useDialogs((state) => state.open)
