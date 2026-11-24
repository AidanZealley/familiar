import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { machine } from 'node:os'
import { dirname, resolve } from 'node:path'
import {
  McpServer,
  type CallToolResult,
  type ServerContext,
} from '@modelcontextprotocol/server'
import type { Page } from 'playwright'
import { z } from 'zod'
import {
  annotationsOf,
  ASLEEP,
  computerTools,
  CONTROL_TOOL,
  type ComputerTool,
  INFO_TOOL,
  PROGRESS_MS,
  SIGN_IN_TOOL,
  signInControls,
  type ComputerInfo,
  PERSON_USED,
  type ComputerToolName,
} from '../tools.ts'
import { KEEP_TEXT } from '../shorten.ts'
import type { Activity } from './activity.ts'
import type { Browser } from './browser.ts'
import type { CallKind, ComputerControl } from './control.ts'
import { installedOn, type Restoring } from './restore.ts'
import { screen } from './screen.ts'
import { runCommand } from './shell.ts'
import { signIn } from './sign-in.ts'

type Args<Name extends ComputerToolName> = z.infer<
  (typeof computerTools)[Name]['input']
>

/**
 * Each tool's handler. `using`: a person has control, so a read may run but
 * must not change the display, such as by starting the browser.
 */
type Handlers = {
  [Name in ComputerToolName]: (
    args: Args<Name>,
    signal: AbortSignal,
    using: boolean,
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

const NO_PAGE =
  "The browser has no page open, and a person is using the computer, so it wasn't opened. Look again once they hand it back."

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

/** What a tool does, for `control`: the browser and screen tools use the display. */
const kindOf = (name: string, tool: ComputerTool): CallKind => ({
  reads: tool.reads === true,
  display: name.startsWith('browser_') || name.startsWith('screen_'),
})

/**
 * The computer's MCP server, one per connection, over the machine's one
 * browser, file system, `activity`, which counts every call but a look
 * (the info tool), and `control`, which says whether a call may run while
 * a person takes over. `home` is where commands run and relative paths
 * start. Familiar tools wait for `restored` to finish, and the first to run
 * carries its note.
 */
export function computerServer(
  browser: Browser,
  home: string,
  activity: Activity,
  control: ComputerControl,
  restored: Restoring,
) {
  /** Runs `act` on the open page and answers with its snapshot after. */
  const onPage =
    <A>(act: (page: Page, args: A, signal: AbortSignal) => Promise<unknown>) =>
    async (args: A, signal: AbortSignal, using: boolean) => {
      const shown = await browser.page({ open: !using })
      if (!shown) {
        return text(NO_PAGE, true)
      }
      const { page, started } = shown
      await act(page, args, signal)
      return text((started ? STARTED : '') + (await browser.snapshot(page)))
    }

  const handlers: Handlers = {
    browser_snapshot: onPage(async () => {}),
    browser_screenshot: async (_args, _signal, using) => {
      const shown = await browser.page({ open: !using })
      return shown
        ? png(
            // The caret as it is: by default Playwright hides it while it
            // captures, under the hands of a person typing.
            await shown.page.screenshot({ type: 'png', caret: 'initial' }),
          )
        : text(NO_PAGE, true)
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
      using: boolean,
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
          try {
            // A computer made again finishes restoring first, so the call
            // finds what it had. Not under `control`, so a person taking
            // over doesn't wait for it.
            await restored.done
            const outcome = await control.run(
              call,
              kindOf(name, tool),
              signal,
              () => (stopWaiting = progress(ctx, WAITING)),
              // Its own failure is its result, so a note still goes with it,
              // as does what restoring put back, for the first to run.
              async (using): Promise<CallToolResult> => {
                const note = restored.takeNote()
                const result = await handle(args, signal, using).catch(
                  (error: unknown) =>
                    text(
                      error instanceof Error ? error.message : String(error),
                      true,
                    ),
                )
                return note
                  ? {
                      ...result,
                      content: [
                        { type: 'text', text: note },
                        ...result.content,
                      ],
                    }
                  : result
              },
            )
            if (!outcome.ran) {
              return {
                ...text(outcome.note, true),
                _meta: { [PERSON_USED]: true },
              }
            }
            const { value: result, note } = outcome
            return note
              ? {
                  ...result,
                  _meta: { ...result._meta, [PERSON_USED]: true },
                  content: [{ type: 'text', text: note }, ...result.content],
                }
              : result
          } catch (error) {
            return text(
              error instanceof Error ? error.message : String(error),
              true,
            )
          } finally {
            stopWaiting()
          }
        })) ?? ASLEEP_RESULT,
    )
  }
  server.registerTool(
    SIGN_IN_TOOL,
    {
      description: 'For the host: fill and submit a saved login.',
      inputSchema: z.object({
        origin: z.string(),
        username: z.string(),
        password: z.string(),
        controls: signInControls,
      }),
    },
    async (login, ctx) =>
      (await activity.run(SIGN_IN_TOOL, {}, async (call) => {
        const signal = ctx.mcpReq.signal
        let stopWaiting = () => {}
        try {
          const outcome = await control.run(
            call,
            { reads: false, display: true },
            signal,
            () => (stopWaiting = progress(ctx, WAITING)),
            async () => {
              const shown = await browser.page({ open: false })
              signal.throwIfAborted()
              const { controls, ...credentials } = login
              return shown
                ? signIn(shown.page, credentials, controls, signal)
                : {
                    text: "There's no open browser tab. Open the site's login page first.",
                    isError: true,
                  }
            },
          )
          if (!outcome.ran) {
            return text(outcome.note, true)
          }
          // An action only runs with no note: no one took over first.
          return text(outcome.value.text, outcome.value.isError)
        } catch {
          // Never an error's own text: it could hold the login.
          return text(
            "Couldn't sign in. Check the browser before trying again.",
            true,
          )
        } finally {
          stopWaiting()
        }
      })) ?? ASLEEP_RESULT,
  )
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
        'For the host, never a model: the open tabs, the system and what is installed, as JSON.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => {
      const { doing, lastUsed } = activity.now()
      const info: ComputerInfo = {
        lastUsed,
        control: control.current(),
        doing: doing?.map((call) =>
          control.waits(call) ? { ...call, waiting: true as const } : call,
        ),
        tabs: await browser.tabs(),
        system: { os: await osName(), architecture: machine() },
        ...(await installedOn(home)),
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
