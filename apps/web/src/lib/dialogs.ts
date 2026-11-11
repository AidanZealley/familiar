import { create } from 'zustand'

/** A dialog over the page. */
export type DialogRef =
  | { kind: 'familiar'; id: number }
  | { kind: 'room'; id: number }
  | { kind: 'settings' }
  | { kind: 'new-familiar' }
  | { kind: 'new-room' }

/**
 * The one dialog open over the page, if any. Plain app state: it isn't in
 * the URL, and `Dialogs` closes it when the page underneath changes.
 */
const useDialogs = create<{ open?: DialogRef }>(() => ({}))

/** Opens a dialog on its first page: its first category, or a phone's list of them. */
export const openDialog = (dialog: DialogRef) =>
  useDialogs.setState({ open: dialog })

export const closeDialog = () => useDialogs.setState({ open: undefined })

export const useOpenDialog = () => useDialogs((state) => state.open)
