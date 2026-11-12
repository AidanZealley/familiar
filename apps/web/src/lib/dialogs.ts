import { useNavigate, useRouter, useSearch } from '@tanstack/react-router'
import { useMemo } from 'react'

/** A dialog over the page. */
export type DialogRef =
  | { kind: 'familiar'; id: number }
  | { kind: 'room'; id: number }
  | { kind: 'settings' }
  | { kind: 'new-familiar' }
  | { kind: 'new-room' }

/**
 * The open dialog and its category live in the URL's search, on any page:
 * `?dialog=familiar-66&category=memory`. A link opens one, and a phone's
 * Back closes it rather than leaving the page. A page's own links drop the
 * search, so moving to another page closes it.
 */
export type DialogSearch = { dialog?: string; category?: string }

declare module '@tanstack/react-router' {
  interface HistoryState {
    /** This entry was pushed by opening a dialog, so closing it goes back. */
    dialog?: true
  }
}

const text = (value: unknown) => (typeof value === 'string' ? value : undefined)

/** The root route's `validateSearch`: only the dialog's keys, as text. */
export const dialogSearch = (
  search: Record<string, unknown>,
): DialogSearch => ({
  dialog: text(search.dialog),
  category: text(search.category),
})

const encode = (dialog: DialogRef) =>
  'id' in dialog ? `${dialog.kind}-${dialog.id}` : dialog.kind

const decode = (value?: string): DialogRef | undefined => {
  const match = value?.match(/^(familiar|room)-(\d+)$/)
  if (match) {
    return { kind: match[1] as 'familiar' | 'room', id: Number(match[2]) }
  }
  return value === 'settings' ||
    value === 'new-familiar' ||
    value === 'new-room'
    ? { kind: value }
    : undefined
}

/** The dialog open over the page, if any. */
export const useOpenDialog = () => {
  const value = useSearch({ strict: false, select: (search) => search.dialog })
  return useMemo(() => decode(value), [value])
}

/** The open dialog's category, if the URL names one. */
export const useDialogCategory = () =>
  useSearch({ strict: false, select: (search) => search.category })

/**
 * Opens, closes and moves around dialogs. Opening pushes a history entry, so
 * Back closes the dialog; choosing a category replaces it. Closing goes back
 * over the entry it pushed, or, for a dialog that arrived in the URL,
 * replaces the URL without it. `close` resolves once it has.
 */
export const useDialogs = () => {
  const router = useRouter()
  const navigate = useNavigate()

  return useMemo(
    () => ({
      open: (dialog: DialogRef) =>
        navigate({
          to: '.',
          search: (prev) => ({
            ...prev,
            dialog: encode(dialog),
            category: undefined,
          }),
          state: { dialog: true },
        }),
      showCategory: (category?: string) =>
        navigate({
          to: '.',
          search: (prev) => ({ ...prev, category }),
          state: (prev) => prev,
          replace: true,
        }),
      close: () => {
        if (!router.state.location.state.dialog) {
          return navigate({
            to: '.',
            search: (prev) => ({
              ...prev,
              dialog: undefined,
              category: undefined,
            }),
            replace: true,
          })
        }
        return new Promise<void>((resolve) => {
          const stop = router.history.subscribe(() => {
            stop()
            resolve()
          })
          router.history.back()
        })
      },
    }),
    [router, navigate],
  )
}
