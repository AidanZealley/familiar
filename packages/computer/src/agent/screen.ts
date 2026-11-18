import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { setTimeout as wait } from 'node:timers/promises'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** How long an action's effects get to show before the screenshot after it. */
const SETTLE_MS = 300

const BUTTONS = { left: '1', middle: '2', right: '3' }
const WHEEL = { up: '4', down: '5', left: '6', right: '7' }

/** The latest action on the screen; each waits for the one before. */
let acting: Promise<unknown> = Promise.resolve()

/**
 * The display as the screen tools see and use it, through `maim` and
 * `xdotool` on `DISPLAY`, in display pixels from the top left.
 */
export const screen = {
  /**
   * Runs `input`, such as `screen.click`, waits for its effects to show,
   * and gives a screenshot after. One action at a time: the next waits until
   * this one's screenshot is taken, so two never mix their keys, pastes or
   * pictures.
   */
  act: (input: () => Promise<unknown>, signal: AbortSignal) => {
    const run = async () => {
      await input()
      await wait(SETTLE_MS, undefined, { signal })
      return screen.screenshot(signal)
    }
    const result = acting.then(run, run)
    acting = result.catch(() => {})
    return result
  },

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

  /**
   * Types `text`. Keys xdotool makes up for characters outside ASCII never
   * reach Chromium, so text with any is pasted instead, whole, in one go:
   * put in the desktop's clipboard and primary selection (which Xvnc never
   * sends to a viewer), then pasted with shift+Insert, which browsers and
   * terminals both take. An app reads a paste when it gets to the key, so
   * one paste per action, with the queue (`act`) holding the next action
   * back until this one's screenshot, keeps pastes from replacing each
   * other.
   */
  type: async (text: string, signal: AbortSignal) => {
    if (/^[\0-\x7f]*$/.test(text)) {
      return xdotool(signal, 'type', '--delay', '10', '--', text)
    }
    await Promise.all(
      ['clipboard', 'primary'].map((selection) =>
        select(selection, text, signal),
      ),
    )
    await xdotool(signal, 'key', '--clearmodifiers', 'shift+Insert')
  },

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
}

// Without `--sync`, which waits for a move forever when the pointer is
// already there.
const moveTo = (x: number, y: number) => ['mousemove', String(x), String(y)]

/**
 * Puts `text` in an X selection. xclip stays behind to serve it, holding
 * nothing open of ours, so this ends as soon as it's set.
 */
const select = async (selection: string, text: string, signal: AbortSignal) => {
  const xclip = spawn('xclip', ['-selection', selection, '-in'], {
    stdio: ['pipe', 'ignore', 'ignore'],
    signal,
  })
  // Both, so a stopped call's broken pipe fails the call, not the agent.
  const [, [code]] = await Promise.all([
    pipeline(Readable.from([text]), xclip.stdin),
    once(xclip, 'exit'),
  ])
  if (code !== 0) {
    throw new Error(`Couldn't paste the text (xclip exit code ${code}).`)
  }
}

/** Runs xdotool; one that can't do what it's asked fails with its message. */
const xdotool = async (signal: AbortSignal, ...args: string[]) => {
  const { stderr } = await run('xdotool', args, { signal })
  // It reports a key name it doesn't know, and carries on without it.
  if (stderr.trim()) {
    throw new Error(stderr.trim())
  }
}
