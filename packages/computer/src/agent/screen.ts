import { execFile } from 'node:child_process'
import { setTimeout as wait } from 'node:timers/promises'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** How long an action's effects get to show before the screenshot after it. */
const SETTLE_MS = 300

const BUTTONS = { left: '1', middle: '2', right: '3' }
const WHEEL = { up: '4', down: '5', left: '6', right: '7' }

/**
 * The display as the screen tools see and use it, through `maim` and
 * `xdotool` on `DISPLAY`, in display pixels from the top left.
 */
export const screen = {
  /** The whole screen as a PNG. */
  screenshot: async (signal?: AbortSignal) =>
    (
      await run('maim', ['--format', 'png'], {
        encoding: 'buffer',
        maxBuffer: 64 * 1024 * 1024,
        signal,
      })
    ).stdout,

  click: (
    x: number,
    y: number,
    button: keyof typeof BUTTONS,
    double: boolean,
    signal: AbortSignal,
  ) =>
    xdotool(
      signal,
      ...moveTo(x, y),
      'click',
      ...(double ? ['--repeat', '2'] : []),
      BUTTONS[button],
    ),

  type: (text: string, signal: AbortSignal) =>
    xdotool(signal, 'type', '--delay', '10', '--', text),

  /** Presses each of `keys` in turn, such as `ctrl+l` or `Return`. */
  key: (keys: string[], signal: AbortSignal) =>
    xdotool(signal, 'key', '--clearmodifiers', '--', ...keys),

  scroll: (
    x: number,
    y: number,
    direction: keyof typeof WHEEL,
    amount: number,
    signal: AbortSignal,
  ) =>
    xdotool(
      signal,
      ...moveTo(x, y),
      'click',
      '--repeat',
      String(amount),
      WHEEL[direction],
    ),

  /**
   * The names of `windowClass`'s shown windows, such as a browser window's
   * name, which is its shown tab's title: the focused one first.
   */
  windowNames: async (windowClass: string) => {
    const names = (...args: string[]) =>
      run('xdotool', [...args, 'getwindowname', '%@']).then(
        ({ stdout }) => stdout.split('\n').filter(Boolean),
        // Nothing found, or no window has focus.
        (): string[] => [],
      )
    const [focused, shown] = await Promise.all([
      names('getactivewindow'),
      names('search', '--onlyvisible', '--class', windowClass),
    ])
    return [...focused.filter((name) => shown.includes(name)), ...shown]
  },

  /** Waits for an action's effects to show. */
  settle: (signal: AbortSignal) => wait(SETTLE_MS, undefined, { signal }),
}

// Without `--sync`, which waits for a move forever when the pointer is
// already there.
const moveTo = (x: number, y: number) => ['mousemove', String(x), String(y)]

/** Runs xdotool; one that can't do what it's asked fails with its message. */
const xdotool = async (signal: AbortSignal, ...args: string[]) => {
  const { stderr } = await run('xdotool', args, { signal })
  // It reports a key name it doesn't know, and carries on without it.
  if (stderr.trim()) {
    throw new Error(stderr.trim())
  }
}
