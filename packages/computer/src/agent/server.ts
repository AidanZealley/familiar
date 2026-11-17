import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { McpServer, type CallToolResult } from '@modelcontextprotocol/server'
import type { z } from 'zod'
import {
  annotationsOf,
  computerTools,
  type ComputerToolName,
} from '../tools.ts'
import { KEEP_TEXT } from '../shorten.ts'
import type { Browser } from './browser.ts'
import { runCommand } from './shell.ts'

type Args<Name extends ComputerToolName> = z.infer<
  (typeof computerTools)[Name]['input']
>

type Handlers = {
  [Name in ComputerToolName]: (
    args: Args<Name>,
    signal: AbortSignal,
  ) => Promise<CallToolResult>
}

const text = (text: string, isError = false): CallToolResult => ({
  content: [{ type: 'text', text }],
  isError,
})

const STARTED =
  'The browser has just started, so any pages opened before are gone.\n\n'

/**
 * The computer's MCP server, one per connection, over the machine's one
 * browser and file system. `home` is where commands run and
 * relative paths start.
 */
export function computerServer(browser: Browser, home: string) {
  /** Runs `act` on the open page and answers with its snapshot after. */
  const onPage =
    <A>(
      act: (
        page: Awaited<ReturnType<Browser['page']>>['page'],
        args: A,
        signal: AbortSignal,
      ) => Promise<unknown>,
    ) =>
    async (args: A, signal: AbortSignal) => {
      const { page, started } = await browser.page()
      await act(page, args, signal)
      return text((started ? STARTED : '') + (await browser.snapshot(page)))
    }

  const handlers: Handlers = {
    browser_snapshot: onPage(async () => {}),
    browser_screenshot: async () => {
      const { page } = await browser.page()
      return {
        content: [
          {
            type: 'image',
            data: (await page.screenshot({ type: 'png' })).toString('base64'),
            mimeType: 'image/png',
          },
        ],
      }
    },
    browser_navigate: onPage((page, { url }) => page.goto(url)),
    browser_click: onPage((page, { ref }, signal) =>
      browser.element(page, ref).click({ signal }),
    ),
    browser_type: onPage(async (page, { ref, text, submit }, signal) => {
      const field = browser.element(page, ref)
      await field.fill(text, { signal })
      if (submit) {
        await field.press('Enter', { signal })
      }
    }),
    run_command: async ({ command, timeout_seconds = 60 }, signal) => {
      const { code, output, timedOut } = await runCommand(command, {
        cwd: home,
        timeoutMs: timeout_seconds * 1000,
        signal,
      })
      const status = timedOut
        ? `Stopped after ${timeout_seconds} seconds.`
        : `Exit code ${code}.`
      // The status last, as the host keeps the end of long output.
      return text(`${output}\n${status}`, code !== 0)
    },
    read_file: async ({ path }) =>
      text((await readFile(resolve(home, path), 'utf8')).slice(0, KEEP_TEXT)),
    write_file: async ({ path, content }) => {
      const file = resolve(home, path)
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, content)
      return text(`Wrote ${file}.`)
    },
  }

  const server = new McpServer({ name: 'familiar-computer', version: '1.0.0' })
  for (const [name, tool] of Object.entries(computerTools)) {
    const handle = handlers[name as ComputerToolName] as (
      args: unknown,
      signal: AbortSignal,
    ) => Promise<CallToolResult>
    server.registerTool(
      name,
      {
        description: tool.description,
        inputSchema: tool.input as z.ZodObject,
        annotations: annotationsOf(tool),
      },
      async (args, ctx) => {
        try {
          return await handle(args, ctx.mcpReq.signal)
        } catch (error) {
          return text(
            error instanceof Error ? error.message : String(error),
            true,
          )
        }
      },
    )
  }
  return server
}
