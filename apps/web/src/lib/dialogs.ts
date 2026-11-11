import {
  useLocation,
  useNavigate,
  useRouter,
  useSearch,
} from '@tanstack/react-router'
import { useIsPhone } from './media'

/**
 * Which dialog is open over the page, and where in it, lives in the URL:
 * `?dialog=familiar:1&category=tools`, `?dialog=room:22&category=lead`,
 * `?dialog=settings&category=connections`. Opening one pushes a history
 * entry, so Back closes it and any link can open a category. No category
 * means the first on a wide screen, and the list of them on a phone.
 */
export type DialogRef =
  | { kind: 'familiar'; id: number }
  | { kind: 'room'; id: number }
  | { kind: 'settings' }
  | { kind: 'new-familiar' }
  | { kind: 'new-room' }

/** The app's search params, which every route shares. */
export type AppSearch = {
  /** The open dialog, as `encode` writes it. */
  dialog?: string
  /** Its category, by ID. */
  category?: string
  /** Settings › Connections: the one shown, as `kind:name`. */
  connection?: string
  /** Settings › Connections: the search. */
  q?: string
}

const text = (value: unknown) =>
  typeof value === 'string' && value ? value : undefined

export const validateAppSearch = (
  search: Record<string, unknown>,
): AppSearch => ({
  dialog: text(search.dialog),
  category: text(search.category),
  connection: text(search.connection),
  q: text(search.q),
})

const encode = (dialog: DialogRef) =>
  'id' in dialog ? `${dialog.kind}:${dialog.id}` : dialog.kind

const decode = (value: string | undefined): DialogRef | undefined => {
  if (
    value === 'settings' ||
    value === 'new-familiar' ||
    value === 'new-room'
  ) {
    return { kind: value }
  }
  const [kind, id] = (value ?? '').split(':')
  return (kind === 'familiar' || kind === 'room') && /^\d+$/.test(id ?? '')
    ? { kind, id: Number(id) }
    : undefined
}

/**
 * Kept in each history entry: how many entries the open dialog has pushed,
 * so closing steps back past all of them, and whether a phone came to this
 * category from the dialog's list, so its Back returns there.
 */
type DialogHistory = { dialogDepth?: number; fromList?: boolean }

const depthOf = (state: object) => (state as DialogHistory).dialogDepth ?? 0

/** History state for one more entry pushed inside the dialog. */
export const pushedState = <State extends object>(
  previous: State,
  fromList = false,
): State =>
  Object.assign({}, previous, {
    dialogDepth: depthOf(previous) + 1,
    fromList,
  } satisfies DialogHistory)

/** Search that opens `dialog` on `category` over the current page. */
export const dialogSearch = (
  dialog: DialogRef,
  category?: string,
): AppSearch => ({ dialog: encode(dialog), category })

/** The open dialog, and the means to move through it and close it. */
export const useDialog = () => {
  const search = useSearch({ from: '__root__' })
  const state = useLocation({ select: (location) => location.state })
  const navigate = useNavigate()
  const router = useRouter()
  const isPhone = useIsPhone()
  const dialog = decode(search.dialog)

  /** Opens a dialog, or switches to another: one more Back to undo. */
  const open = (next: DialogRef, category?: string) =>
    navigate({
      to: '.',
      search: dialogSearch(next, category),
      state: (previous) => pushedState(previous),
    })

  /**
   * Shows a category. On a phone it's a screen of its own, so it's a history
   * entry and Back returns to the list; on a wide screen it replaces, so Back
   * closes the dialog.
   */
  const showCategory = (category: string) =>
    dialog &&
    navigate({
      to: '.',
      search: dialogSearch(dialog, category),
      replace: !isPhone,
      state: isPhone ? (previous) => pushedState(previous, true) : true,
    })

  /** A phone's Back from a category: to the list it came from, or to the list in place of a linked one. */
  const backToList = () => {
    if ((state as DialogHistory).fromList) {
      router.history.back()
    } else if (dialog) {
      void navigate({
        to: '.',
        search: dialogSearch(dialog),
        replace: true,
        state: true,
      })
    }
  }

  /**
   * Back to the page under the dialog: back through the entries it pushed,
   * then, if that lands where a link opened it, out of it in place.
   */
  const close = () => {
    const leave = () =>
      navigate({ to: '.', search: {}, replace: true, state: true })
    const depth = depthOf(state)
    if (depth === 0) {
      void leave()
      return
    }
    const stop = router.history.subscribe(({ location }) => {
      stop()
      if (new URLSearchParams(location.search).has('dialog')) {
        void leave()
      }
    })
    router.history.go(-depth)
  }

  return {
    dialog,
    category: search.category,
    isPhone,
    open,
    showCategory,
    backToList,
    close,
  }
}
