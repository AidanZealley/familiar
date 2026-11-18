import type { FamiliarSummary } from '@familiar-ai/client'
import { useSyncExternalStore } from 'react'
import { toast } from 'sonner'

/**
 * Whether this tab has a Familiar's computer: not, waking it and asking
 * for it, or held, so what's typed and clicked on its screen reaches it.
 */
export type ControlState = 'off' | 'taking' | 'held'

/** Longer than the server's ping interval (5 s) with nothing heard: the server has gone. */
const SILENT_MS = 15_000

type Control = {
  state: Exclude<ControlState, 'off'>
  /**
   * Ends it now, once: input stops at once, before the socket has finished
   * closing. With why, it ended by itself and says so; without, this tab
   * handed back.
   */
  end: (why?: string) => void
}

/**
 * Each Familiar's control socket in this tab, the one owner of whether the
 * tab has control: control lasts exactly as long as its socket. Every view
 * of the screen reads it.
 */
const controls = new Map<FamiliarSummary['id'], Control>()
const listeners = new Set<() => void>()
const changed = () => listeners.forEach((listener) => listener())

const controlUrl = (familiar: FamiliarSummary['id']) => {
  const url = new URL(
    `/api/plugins/computer/familiars/${familiar}/control`,
    window.location.href,
  )
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.href
}

/**
 * Takes over `familiar`'s computer, waking it if it sleeps, until
 * `handBack`, the tab closing or the connection dropping. Says why in a
 * toast if it's refused or ends by itself.
 */
export function takeOver(familiar: FamiliarSummary) {
  if (controls.has(familiar.id)) {
    return
  }
  const socket = new WebSocket(controlUrl(familiar.id))
  let silence: ReturnType<typeof setTimeout> | undefined
  const control: Control = {
    state: 'taking',
    end: (why) => {
      if (controls.get(familiar.id) !== control) {
        return
      }
      clearTimeout(silence)
      controls.delete(familiar.id)
      changed()
      // A dead connection may take a while to close: it's over already.
      socket.close()
      if (why === undefined) {
        return
      }
      if (control.state === 'taking') {
        toast.error(`Couldn't take over ${familiar.name}'s computer.`, {
          description: why,
        })
      } else {
        toast(`${familiar.name} has the computer back.`, { description: why })
      }
    },
  }
  controls.set(familiar.id, control)
  changed()

  const lost = 'The connection was lost.'
  const heard = () => {
    clearTimeout(silence)
    silence = setTimeout(() => control.end(lost), SILENT_MS)
  }
  heard()
  socket.addEventListener('message', ({ data }) => {
    // Nothing more once it's over, such as a `held` after cancelling.
    if (controls.get(familiar.id) !== control) {
      return
    }
    heard()
    if (data === 'held') {
      control.state = 'held'
      changed()
    } else {
      // Any answer keeps the server's check that this tab is still here.
      socket.send('pong')
    }
  })
  socket.addEventListener('close', ({ code, reason }) =>
    control.end(((code === 1000 || code >= 4000) && reason) || lost),
  )
}

/** Hands `familiar`'s computer back, if this tab has it or is taking it. */
export function handBack(familiar: FamiliarSummary['id']) {
  controls.get(familiar)?.end()
}

// Leaving the page hands back at once, rather than when the server notices.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    for (const familiar of controls.keys()) {
      handBack(familiar)
    }
  })
}

/** Whether this tab has `familiar`'s computer. */
export const useComputerControl = (
  familiar: FamiliarSummary['id'] | undefined,
) =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    (): ControlState =>
      familiar === undefined ? 'off' : (controls.get(familiar)?.state ?? 'off'),
  )
