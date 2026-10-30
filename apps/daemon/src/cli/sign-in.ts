// Sign in with ChatGPT once; the daemon refreshes the token from then on.
// Usage: pnpm sign-in

import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import { config, deviceId } from '../config.ts'
import { openModels } from '../models.ts'

export async function signIn() {
  const models = openModels()
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  try {
    await models.login(
      'openai',
      'oauth',
      {
        signal: new AbortController().signal,
        prompt: async (prompt) => {
          // The browser normally completes the login through a local callback. If
          // you signed in on another device, paste the URL it ended on instead.
          return terminal.question(`${prompt.message}\n> `, {
            signal: prompt.signal,
          })
        },
        notify: (event) => {
          if (event.type === 'auth_url') {
            console.log(`\nOpen:\n${event.url}\n`)
            const headless =
              process.env.SSH_CONNECTION ||
              (process.platform === 'linux' &&
                !process.env.DISPLAY &&
                !process.env.WAYLAND_DISPLAY)
            if (headless) {
              console.log(
                'Open the link on your other device, then paste the full URL the browser redirects to here.',
              )
            } else {
              const command =
                process.platform === 'darwin'
                  ? 'open'
                  : process.platform === 'win32'
                    ? 'rundll32.exe'
                    : 'xdg-open'
              const args =
                process.platform === 'win32'
                  ? ['url.dll,FileProtocolHandler', event.url]
                  : [event.url]
              const browser = spawn(command, args, {
                detached: true,
                stdio: 'ignore',
              })
              browser.on('error', () =>
                console.log('Open the sign-in link above in your browser.'),
              )
              browser.unref()
            }
          } else if ('message' in event) {
            console.log(event.message)
          }
        },
      },
      { getDeviceId: deviceId, agentName: config.name },
    )
  } finally {
    terminal.close()
  }
  const model = models.getModel(config.model.provider, config.model.modelId)
  console.log(
    model
      ? `\nSigned in. ${model.name} is available.`
      : `\nSigned in, but ${config.model.modelId} is not in the catalog; set FAMILIAR_MODEL.`,
  )
}
