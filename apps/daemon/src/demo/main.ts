import { computer } from '@familiar-ai/computer'
import { dockerHost } from '@familiar-ai/computer/docker'
import { resolvePaths } from '../paths.ts'
import { openPush } from '../push.ts'
import { serveWorkspace } from '../serve.ts'
import { openDemo } from './demo.ts'

// Keys and subscriptions last only until the demo restarts.
const push = openPush({ contact: 'mailto:familiar@example.com' })
let maxComputers = 10
const workspace = await openDemo(
  async (notification) => {
    console.log('Notification:', JSON.stringify(notification))
    await push.notify(notification)
  },
  // Real computers where Docker is installed, under their own host ID so
  // the installation's are left alone. No Familiar has one when the demo
  // starts, so starting it removes any an earlier run left.
  [computer({ host: dockerHost({ hostId: 'demo' }) })],
)
serveWorkspace(workspace, {
  host: '127.0.0.1',
  port: Number(process.env.FAMILIAR_DEMO_PORT ?? 4318),
  owner: 'demo',
  label: 'Familiar demo',
  // Only read, so the demo shows the owner's portraits without touching their data.
  avatarsDir: resolvePaths().avatarsDir,
  push: push.host,
  // Kept only until the demo restarts, like its keys.
  computerLimit: {
    get: () => maxComputers,
    set: (value) => {
      maxComputers = value
    },
  },
})
