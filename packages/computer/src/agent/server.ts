import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { machine } from 'node:os'
import { dirname, resolve } from 'node:path'
import {
  McpServer,
  type CallToolResult,
  type ServerContext,
} from '@modelcontextprotocol/server'
import { z } from 'zod'
import {
  annotationsOf,
  ASLEEP,
  computerTools,
  CONTROL_TOOL,
  INFO_TOOL,
  PROGRESS_MS,
  type ComputerInfo,
  type ComputerToolName,
} from '../tools.ts'
import { KEEP_TEXT } from '../shorten.ts'
import type { Activity } from './activity.ts'
import type { Browser } from './browser.ts'
import type { ComputerControl } from './control.ts'
import { screen } from './screen.ts'
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

const png = (data: Buffer): CallToolResult => ({
  content: [
    { type: 'image', data: data.toString('base64'), mimeType: 'image/png' },
  ],
})

/** Does `act` on the screen and answers with a screenshot after. */
const onScreen =
  <A>(act: (args: A, signal: AbortSignal) => Promise<unknown>) =>
  async (args: A, signal: AbortSignal) =>
    png(await screen.act(() => act(args, signal), signal))

const STARTED =
  'The browser has just started, so any pages opened before are gone.\n\n'

/** What a call gets once the agent is going to sleep: it ran nothing. */
const ASLEEP_RESULT: CallToolResult = {
  ...text('The computer is going to sleep, so nothing ran.', true),
  _meta: { [ASLEEP]: true },
}

/**
 * Sends progress on the call `ctx` belongs to now and every `PROGRESS_MS`,
 * until the returned function stops it. Nothing if the caller asked for none.
 */
const progress = (ctx: ServerContext, message: string) => {
  const token = ctx.mcpReq._meta?.progressToken
  if (token === undefined) {
    return () => {}
  }
  let count = 0
  const send = () =>
    void ctx.mcpReq
      .notify({
        method: 'notifications/progress',
        params: { progressToken: token, progress: ++count, message },
      })
      .catch(() => {})
  send()
  const timer = setInterval(send, PROGRESS_MS)
  return () => clearInterval(timer)
}

const WAITING = 'Waiting for the person to hand back the computer.'

/**
 * The computer's MCP server, one per connection, over the machine's one
 * browser, file system, `activity`, which counts every call but a look
 * (the info tool), and `control`, which says whether a call may run while
 * a person takes over. `home` is where commands run and relative paths
 * start.
 */
export function computerServer(
  browser: Browser,
  home: string,
  activity: Activity,
  control: ComputerControl,
) {
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
      return png(await page.screenshot({ type: 'png' }))
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
    screen_screenshot: async (_args, signal) =>
      png(await screen.screenshot(signal)),
    screen_click: onScreen(
      ({ x, y, button = 'left', double = false }, signal) =>
        screen.click(x, y, button, double, signal),
    ),
    screen_type: onScreen(({ text }, signal) => screen.type(text, signal)),
    screen_key: onScreen(({ keys }, signal) =>
      screen.key(keys.split(/\s+/).filter(Boolean), signal),
    ),
    screen_scroll: onScreen(({ x, y, direction, amount = 3 }, signal) =>
      screen.scroll(x, y, direction, amount, signal),
    ),
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
      async (args, ctx) =>
        (await activity.run(name, args, async (call) => {
          const { signal } = ctx.mcpReq
          let stopWaiting = () => {}
          /** What to tell the Familiar first, if a person has used it. */
          let note: string | undefined
          let result: CallToolResult
          try {
            const turn = await control.turn(
              call,
              'reads' in tool,
              signal,
              () => (stopWaiting = progress(ctx, WAITING)),
            )
            stopWaiting()
            note = turn.note
            if (!turn.run) {
              return text(note!, true)
            }
            result = await handle(args, signal)
          } catch (error) {
            result = text(
              error instanceof Error ? error.message : String(error),
              true,
            )
          } finally {
            stopWaiting()
          }
          return note
            ? {
                ...result,
                content: [{ type: 'text', text: note }, ...result.content],
              }
            : result
        })) ?? ASLEEP_RESULT,
    )
  }
  server.registerTool(
    CONTROL_TOOL,
    {
      description:
        'For the host, never a model: a person has control of the computer until this call is cancelled.',
      inputSchema: z.object({}),
    },
    async (_args, ctx) =>
      (await activity.run(
        CONTROL_TOOL,
        {},
        async () => {
          let stop = () => {}
          try {
            const refused = await control.hold(ctx.mcpReq.signal, () => {
              stop = progress(ctx, 'The person has control.')
            })
            return refused ? text(refused, true) : text('Handed back.')
          } finally {
            stop()
          }
        },
        { unlisted: true },
      )) ?? ASLEEP_RESULT,
  )
  server.registerTool(
    INFO_TOOL,
    {
      description:
        'For the host, never a model: the open tabs and the system, as JSON.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => {
      const { doing, lastUsed } = activity.now()
      const info: ComputerInfo = {
        lastUsed,
        doing: doing?.map((call) =>
          control.waits(call) ? { ...call, waiting: true as const } : call,
        ),
        tabs: await browser.tabs(),
        system: { os: await osName(), architecture: machine() },
      }
      return text(JSON.stringify(info))
    },
  )
  return server
}

/** The distribution's name, such as "Debian GNU/Linux 12 (bookworm)". */
const osName = async () =>
  (await readFile('/etc/os-release', 'utf8').catch(() => '')).match(
    /^PRETTY_NAME="?([^"\n]*)"?$/m,
  )?.[1]
