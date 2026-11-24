import { defineTool, familiar } from '@familiar-ai/core'
import { z } from 'zod'
import { callComputer } from './call.ts'
import type { ComputerHost } from './host.ts'
import { siteOrigin, type ComputerLogins } from './logins.ts'
import { SIGN_IN_TOOL, signInControls } from './tools.ts'

const result = (text: string, isError = false) => ({
  output: [{ type: 'text' as const, text }],
  isError,
})

const site = siteOrigin.describe(
  'The login page’s URL or origin, such as https://example.com',
)

/** The tools that let a Familiar use its saved logins, never seeing a password. */
export function loginTools(host: ComputerHost, logins: ComputerLogins) {
  return [
    defineTool({
      name: 'saved_logins',
      description:
        'List the sites and usernames of your saved logins. Passwords are never shown.',
      parameters: z.toJSONSchema(z.object({})) as object,
      replay: 'safe',
      execute: async (_args, _api, context) => {
        const saved = await logins.list(await familiar(context).familiarId())
        return result(
          saved.length
            ? saved
                .map(({ origin, username }) => `${origin} ${username}`)
                .join('\n')
            : 'No saved logins. Use request_login to ask for one.',
        )
      },
    }),
    defineTool({
      name: 'request_login',
      description:
        'Ask the owner, in a private form in the chat, to save a login for a site. Never ask for a password in chat.',
      parameters: z.toJSONSchema(z.object({ site }), { io: 'input' }) as object,
      execute: async (args: { site: string }, _api, context) => {
        const origin = siteOrigin.safeParse(args.site)
        if (!origin.success) {
          return result('Give the site as an https:// URL.', true)
        }
        const services = familiar(context)
        const reply = await services.askPrivately({
          message: `Save a login for ${origin.data}. Only the computer plugin gets the password; it's never shown in the chat.`,
          form: [
            {
              name: 'username',
              title: 'Username',
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
        })
        if (reply.action !== 'accept') {
          return result(
            reply.action === 'decline'
              ? 'The owner declined to save a login.'
              : 'The person sent a new message instead of saving a login.',
            true,
          )
        }
        const username = String(reply.values.username)
        await logins.save(await services.familiarId(), {
          origin: origin.data,
          username,
          password: String(reply.values.password),
        })
        return result(
          `Saved the login for ${username} at ${origin.data}. Sign in with sign_in.`,
        )
      },
    }),
    defineTool({
      name: 'sign_in',
      description:
        'Sign in with a saved login (see saved_logins). Open the login page and take a fresh browser snapshot first, including on retries. Pass the username and password field refs and the Log In button ref; if the button has no ref, pass its exact accessible name as submitLabel.',
      parameters: z.toJSONSchema(
        z.object({ site, username: z.string(), controls: signInControls }),
        { io: 'input' },
      ) as object,
      annotations: { destructiveHint: true },
      execute: async (
        args: {
          site: string
          username: string
          controls: z.infer<typeof signInControls>
        },
        api,
        context,
      ) => {
        const origin = siteOrigin.safeParse(args.site)
        const login =
          origin.success &&
          (await logins.find(await familiar(context).familiarId(), {
            origin: origin.data,
            username: args.username,
          }))
        if (!login) {
          return result(
            `No login is saved for ${args.username} at ${args.site}. Check saved_logins, or use request_login.`,
            true,
          )
        }
        return callComputer(
          host,
          SIGN_IN_TOOL,
          { ...login, controls: args.controls },
          api,
          context,
        )
      },
    }),
  ]
}
