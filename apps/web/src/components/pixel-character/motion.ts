/**
 * One animation loop for every character on screen: each looks towards the
 * pointer while it moves, otherwise glances around, blinks now and then, and
 * bobs while its Familiar replies. Characters off screen are skipped, and
 * reduced motion leaves them all still.
 */

export type Look = { x: number; y: number }
export type Watched = {
  element: Element
  talking: () => boolean
  draw: (look: Look, lid: number, bob: number) => void
}

type State = Watched & {
  look: Look
  target: Look
  wander: number
  blinkAt: number
  blink: number
  phase: number
}

const watched = new Set<State>()
let pointer: Look | undefined
let lastMove = 0
let running = false

const frame = (now: number) => {
  for (const state of watched) {
    const box = state.element.getBoundingClientRect()
    if (box.bottom < 0 || box.top > innerHeight || box.width === 0) {
      continue
    }
    if (pointer && now - lastMove < 2500) {
      const dx = pointer.x - (box.left + box.width / 2)
      const dy = pointer.y - (box.top + box.height / 2)
      const distance = Math.hypot(dx, dy)
      const scale = Math.min(1, distance / 260) / (distance || 1)
      state.target = { x: dx * scale, y: dy * scale }
    } else if (now > state.wander) {
      state.target =
        Math.random() < 0.35
          ? { x: 0, y: 0 }
          : { x: Math.random() * 2 - 1, y: Math.random() * 1.4 - 0.7 }
      state.wander = now + 900 + Math.random() * 1700
    }
    state.look.x += (state.target.x - state.look.x) * 0.14
    state.look.y += (state.target.y - state.look.y) * 0.14
    if (now > state.blinkAt) {
      state.blink = now
      state.blinkAt = now + 1800 + Math.random() * 3400
    }
    const blink = (now - state.blink) / 140
    const lid = blink >= 0 && blink < 2 ? 1 - Math.abs(1 - blink) : 0
    const bob = state.talking() ? Math.sin(now / 90 + state.phase) : 0
    state.draw(state.look, lid, bob)
  }
  running = watched.size > 0
  if (running) {
    requestAnimationFrame(frame)
  }
}

if (typeof window !== 'undefined') {
  addEventListener('pointermove', (event) => {
    pointer = { x: event.clientX, y: event.clientY }
    lastMove = performance.now()
  })
}

/** Animates a character until the returned cleanup. */
export function watch(character: Watched) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return () => {}
  }
  const state: State = {
    ...character,
    look: { x: 0, y: 0 },
    target: { x: 0, y: 0 },
    wander: 0,
    blinkAt: performance.now() + 600 + Math.random() * 3400,
    blink: 0,
    phase: Math.random() * 10,
  }
  watched.add(state)
  if (!running) {
    running = true
    requestAnimationFrame(frame)
  }
  return () => {
    watched.delete(state)
  }
}
