import { z } from 'zod'

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
}

const ref = z
  .string()
  .describe('The [ref=…] of the element, from the latest snapshot.')

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
  run_command: {
    description:
      'Runs a shell command on the computer, in its home directory, and returns its exit code and output. Times out after 60 seconds unless given longer, up to 10 minutes.',
    input: z.object({
      command: z.string(),
      timeout_seconds: z.number().int().min(1).max(600).optional(),
    }),
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
export const annotationsOf = (tool: ComputerTool) =>
  tool.reads
    ? { readOnlyHint: true }
    : tool.harmless
      ? { destructiveHint: false }
      : undefined
