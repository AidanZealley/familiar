// Sign in with ChatGPT before the daemon first runs; it refreshes the token
// from then on, and its web UI signs in again if it ever needs to.
// Usage: pnpm sign-in

import { createInterface } from 'node:readline/promises'
import { config, dataPath, deviceId } from './config.ts'
import { lockDataDir } from './lock.ts'
import { openModels } from './models.ts'

// A running daemon keeps its login in memory and would never see this one.
lockDataDir(
  dataPath('daemon.lock'),
  'Sign in from its web UI instead: sign out in Settings, then sign in above the chat.',
)

const models = openModels()
const terminal = createInterface({
  input: process.stdin,
  output: process.stdout,
})

await models.login(
  'openai',
  'oauth',
  {
    signal: new AbortController().signal,
    prompt: async (prompt) => {
      if (prompt.type === 'select') {
        prompt.options.forEach((option, i) =>
          console.log(`  ${i + 1}. ${option.label}`),
        )
        const choice = await terminal.question(`${prompt.message} `)
        return prompt.options[Number(choice) - 1]?.id ?? ''
      }
      // The browser normally completes the login through a local callback. If
      // you signed in on another device, paste the URL it ended on instead.
      return terminal.question(`${prompt.message}\n> `, {
        signal: prompt.signal,
      })
    },
    notify: (event) => {
      if (event.type === 'auth_url') {
        console.log(`\nOpen:\n${event.url}\n`)
      } else if (event.type === 'device_code') {
        console.log(
          `\nOpen ${event.verificationUri} and enter ${event.userCode}\n`,
        )
      } else {
        console.log(event.message)
      }
    },
  },
  { getDeviceId: deviceId, agentName: config.name },
)

terminal.close()
const model = models.getModel(config.model.provider, config.model.modelId)
console.log(
  model
    ? `\nSigned in. ${model.name} is available.`
    : `\nSigned in, but ${config.model.modelId} is not in the catalog; set FAMILIAR_MODEL.`,
)
