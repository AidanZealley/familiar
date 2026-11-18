import { z } from 'zod'
import type { ComputerDetail } from './host.ts'

/**
 * A computer tool as both sides see it: the agent serves it over MCP, and
 * the plugin offers it to Familiars and forwards each call. A tool that
 * `reads` only looks, so it's safe to run again after a restart and needs no
 * approval; any other is an action, which Pi reports as interrupted after a
 * restart rather than running it twice, so the model looks before retrying.
 */
export type ComputerTool = {
  description: string
  input: z.ZodObject
  reads?: true
  /** For an action that is safe to approve once for all, such as opening a page. */
  harmless?: true
  /** Its result's end matters most, as a command's output does: a long one keeps that. */
  keepsEnd?: true
}

const ref = z
  .string()
  .describe('The [ref=…] of the element, from the latest snapshot.')

/** The computer's display, in pixels: its size never changes. */
export const SCREEN = { width: 1280, height: 800 }

const point = {
  x: z
    .number()
    .int()
    .min(0)
    .max(SCREEN.width - 1)
    .describe('Pixels from the left of the screen, as in screen_screenshot.'),
  y: z
    .number()
    .int()
    .min(0)
    .max(SCREEN.height - 1)
    .describe('Pixels from the top of the screen, as in screen_screenshot.'),
}

export const computerTools = {
  browser_snapshot: {
    description:
      "The browser's open page as text: its title, address and elements, each with a ref to use in browser_click and browser_type.",
    input: z.object({}),
    reads: true,
  },
  browser_screenshot: {
    description: "A picture of the browser's open page.",
    input: z.object({}),
    reads: true,
  },
  browser_navigate: {
    description:
      'Opens an address in the browser, then shows the page as browser_snapshot does.',
    input: z.object({ url: z.string().describe('A full URL.') }),
    harmless: true,
  },
  browser_click: {
    description:
      'Clicks an element on the open page, then shows the page as browser_snapshot does.',
    input: z.object({ ref }),
  },
  browser_type: {
    description:
      'Replaces the text in a field on the open page, optionally pressing Enter after, then shows the page as browser_snapshot does.',
    input: z.object({
      ref,
      text: z.string(),
      submit: z.boolean().optional().describe('Press Enter after typing.'),
    }),
  },
  screen_screenshot: {
    description: `A picture of the computer's whole screen, ${SCREEN.width}×${SCREEN.height} pixels: its desktop, taskbar and open windows, the browser's included. Use the screen tools for apps other than the browser, or what the browser tools can't reach.`,
    input: z.object({}),
    reads: true,
  },
  screen_click: {
    description:
      'Clicks at a point on the screen, then shows the screen as screen_screenshot does.',
    input: z.object({
      ...point,
      button: z.enum(['left', 'right', 'middle']).optional(),
      double: z.boolean().optional().describe('Double-click.'),
    }),
  },
  screen_type: {
    description:
      'Types text with the keyboard into whatever has focus on the screen, then shows the screen as screen_screenshot does.',
    input: z.object({ text: z.string() }),
  },
  screen_key: {
    description:
      'Presses a key or key combination, then shows the screen as screen_screenshot does. Keys are X key names joined with +, such as Return, Escape, Tab, BackSpace, ctrl+l or alt+Tab; separate several with spaces to press them in turn.',
    input: z.object({ keys: z.string() }),
  },
  screen_scroll: {
    description:
      'Scrolls with the mouse wheel at a point on the screen, then shows the screen as screen_screenshot does.',
    input: z.object({
      ...point,
      direction: z.enum(['up', 'down', 'left', 'right']),
      amount: z
        .number()
        .int()
        .min(1)
        .max(30)
        .optional()
        .describe('Turns of the wheel. Default 3.'),
    }),
  },
  run_command: {
    description:
      'Runs a shell command on the computer, in its home directory, and returns its exit code and output. Times out after 60 seconds unless given longer, up to 10 minutes. Programs with windows show on the screen: start one in the background (ending the command with &) so the command returns.',
    input: z.object({
      command: z.string(),
      timeout_seconds: z.number().int().min(1).max(600).optional(),
    }),
    keepsEnd: true,
  },
  read_file: {
    description:
      "Reads a text file on the computer. A relative path starts in the computer's home directory.",
    input: z.object({ path: z.string() }),
    reads: true,
  },
  write_file: {
    description:
      "Writes a text file on the computer, replacing it if it exists and creating its folders. A relative path starts in the computer's home directory.",
    input: z.object({ path: z.string(), content: z.string() }),
  },
} satisfies Record<string, ComputerTool>

export type ComputerToolName = keyof typeof computerTools

/** What a tool's annotations say, as MCP and Familiar's approval read them. */
export const annotationsOf = (tool: ComputerTool) => ({
  destructiveHint: !tool.reads && !tool.harmless,
})

/**
 * The agent's hidden tool for a person looking at the computer: what it's
 * doing, its open tabs and system, as JSON text (`ComputerInfo`). It's on
 * the agent's MCP server but not in `computerTools`, so no Familiar is ever
 * offered it, and it never keeps the computer awake.
 */
export const INFO_TOOL = 'computer_info'

export type ComputerInfo = Pick<
  ComputerDetail,
  'doing' | 'lastUsed' | 'tabs' | 'system'
>

/**
 * In a result's `_meta`, set by an agent going to sleep: it ran nothing, so
 * the call is safe to send again once the computer has woken.
 */
export const ASLEEP = 'familiar-ai/asleep'

const TARGET_MAX = 80

/** What a call acts on, shortened for a glance: its URL, command, path or keys. */
export const targetOf = (args: Record<string, unknown>) => {
  const target = [args.url, args.command, args.path, args.keys].find(
    (value) => typeof value === 'string',
  ) as string | undefined
  const line = target?.replace(/\s+/g, ' ').trim()
  return line && line.length > TARGET_MAX
    ? `${line.slice(0, TARGET_MAX - 1)}…`
    : line || undefined
}
