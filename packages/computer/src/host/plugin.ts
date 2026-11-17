import {
  definePlugin,
  defineTool,
  familiar as servicesOf,
  QuestionError,
  type FamiliarId,
} from '@familiar-ai/core'
import type {
  Context,
  ImageContent,
  TextContent,
} from '@familiar-ai/core/extensions'
import { z } from 'zod'
import { shorten } from '../shorten.ts'
import { annotationsOf, computerTools, SIGN_IN } from '../tools.ts'
import type { Computers } from './computers.ts'
import { originOf } from './logins.ts'

/** The plugin's name, which a Familiar's capabilities list to use it. */
export const COMPUTER_PLUGIN = 'computer'

/** Longer than any tool's own limit: the agent stops its own calls first. */
const CALL_MAX_MS = 15 * 60_000

const NO_COMPUTER =
  "You don't have a computer. The person can give you one in Familiar's settings."
const OFFLINE =
  "Your computer is offline: it isn't connected to Familiar. Try again later, or ask the person to check it's on and running the computer agent."

type Output = { output: (TextContent | ImageContent)[]; isError: boolean }

const failed = (text: string): Output => ({
  output: [{ type: 'text', text }],
  isError: true,
})

const site = z
  .string()
  .describe('The website, such as https://example.com, exactly as it signs in.')

/**
 * The computer's tools for Familiars: each call goes to the calling
 * Familiar's own computer, never another's, and every password the
 * computer was given is removed from what comes back before it's shortened
 * for the model.
 */
export function computerPlugin(computers: Computers) {
  /** Calls `name` on `familiar`'s computer, saying why when it can't. */
  const forward = async (
    familiar: FamiliarId,
    name: string,
    args: Record<string, unknown>,
    context: Context,
  ): Promise<Output> => {
    try {
      const result = await computers.use(
        familiar,
        context.abortSignal,
        (computer) =>
          computer.callTool(
            { name, arguments: args },
            { signal: context.abortSignal, timeout: CALL_MAX_MS },
          ),
      )
      if (result === 'none') {
        return failed(NO_COMPUTER)
      }
      if (result === 'offline') {
        return failed(OFFLINE)
      }
      return {
        output: result.content.flatMap<TextContent | ImageContent>((block) =>
          block.type === 'text'
            ? [{ type: 'text', text: block.text }]
            : block.type === 'image'
              ? [{ type: 'image', data: block.data, mimeType: block.mimeType }]
              : [],
        ),
        isError: result.isError ?? false,
      }
    } catch (error) {
      // Stopped, or the host is closing: Pi reports that itself.
      if (context.abortSignal?.aborted) {
        throw error
      }
      const reason = error instanceof Error ? error.message : String(error)
      return failed(
        name === SIGN_IN
          ? `Your computer stopped answering while signing in (${reason}), so whether it submitted the login is unknown. Look at the page; don't sign in again until you have.`
          : `Your computer stopped answering during this call (${reason}), so it may have partly run. Look before trying again.`,
      )
    }
  }

  /**
   * `output` without any of `familiar`'s passwords, then shortened, keeping
   * the start of each text unless `keep` says the end.
   */
  const scrubbed = (
    familiar: FamiliarId,
    { output, isError }: Output,
    keep: 'start' | 'end' = 'start',
  ) => ({
    output: output.map((block) =>
      block.type === 'text'
        ? {
            ...block,
            text: shorten(computers.logins.scrub(familiar, block.text), keep),
          }
        : block,
    ),
    isError,
  })

  const signIn = async (
    familiar: FamiliarId,
    site: string,
    context: Context,
  ) => {
    const login = computers.logins.get(familiar, site)
    if (!login) {
      const sites = computers.logins.list(familiar).map(({ site }) => site)
      return failed(
        `There's no login for ${site} on your computer. ${
          sites.length
            ? `It has logins for ${sites.join(', ')}.`
            : 'It has none.'
        } Use request_login to ask the person for one.`,
      )
    }
    return forward(familiar, SIGN_IN, { origin: site, ...login }, context)
  }

  const requestLogin = async (
    familiar: FamiliarId,
    site: string,
    context: Context,
  ): Promise<Output> => {
    if ((await computers.status(familiar)) === 'none') {
      return failed(NO_COMPUTER)
    }
    const outcome = await servicesOf(context).askPrivately(
      {
        message: `Your login for ${site}, to keep on this Familiar's computer. It signs in with it there, only on ${site}, and never sees the password.`,
        form: [
          {
            name: 'username',
            title: 'Username or email',
            type: 'string',
            required: true,
          },
          {
            name: 'password',
            title: 'Password',
            type: 'string',
            format: 'password',
            required: true,
          },
        ],
      },
      async ({ username, password }) => {
        try {
          computers.logins.set(familiar, site, {
            username: String(username),
            password: String(password),
          })
        } catch (error) {
          throw new QuestionError(
            error instanceof Error ? error.message : String(error),
          )
        }
      },
    )
    return outcome === 'provided'
      ? {
          output: [
            {
              type: 'text',
              text: `The person saved a login for ${site}. Open its sign-in page, then use sign_in.`,
            },
          ],
          isError: false,
        }
      : failed(`The person didn't give a login for ${site}.`)
  }

  /** A tool for `site`, which it takes as an exact origin. */
  const forSite =
    (
      run: (
        familiar: FamiliarId,
        site: string,
        context: Context,
      ) => Promise<Output>,
    ) =>
    async (args: unknown, _api: unknown, context: Context) => {
      const id = await servicesOf(context).familiarId()
      let origin: string
      try {
        origin = originOf((args as { site: string }).site)
      } catch (error) {
        return failed((error as Error).message)
      }
      return scrubbed(id, await run(id, origin, context))
    }

  return definePlugin({
    name: COMPUTER_PLUGIN,
    title: 'Computer',
    tools: [
      ...Object.entries(computerTools).map(([name, tool]) =>
        defineTool({
          name,
          description: tool.description,
          parameters: z.toJSONSchema(tool.input) as object,
          ...('reads' in tool && { replay: 'safe' as const }),
          annotations: annotationsOf(tool),
          execute: async (args, _api, context) => {
            const id = await servicesOf(context).familiarId()
            return scrubbed(
              id,
              await forward(id, name, args as Record<string, unknown>, context),
              'keepsEnd' in tool ? 'end' : 'start',
            )
          },
        }),
      ),
      defineTool({
        name: 'request_login',
        description:
          "Asks the person, privately, for their login to a website, kept on your computer for sign_in. You never see the password, and you can't save, read or move a login yourself.",
        parameters: z.toJSONSchema(z.object({ site })) as object,
        annotations: { destructiveHint: false },
        execute: forSite(requestLogin),
      }),
      defineTool({
        name: SIGN_IN,
        description:
          "Signs in on the browser's open page with the login the person saved for the site: fills its sign-in form and submits it, without you seeing the password, only if the form is on that site exactly. Open the sign-in page first. It never retries: if it says the result is unknown, look at the page before anything else.",
        parameters: z.toJSONSchema(z.object({ site })) as object,
        execute: forSite(signIn),
      }),
    ],
  })
}
