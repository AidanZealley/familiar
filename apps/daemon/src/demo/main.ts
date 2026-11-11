import { openPush } from '../push.ts'
import { serveWorkspace } from '../serve.ts'
import { openDemo } from './demo.ts'

// Keys and subscriptions last only until the demo restarts.
const push = openPush({ contact: 'mailto:familiar@example.com' })
const workspace = await openDemo(async (notification) => {
  console.log('Notification:', JSON.stringify(notification))
  await push.notify(notification)
})
serveWorkspace(workspace, {
  host: '127.0.0.1',
  port: Number(process.env.FAMILIAR_DEMO_PORT ?? 4318),
  owner: 'demo',
  label: 'Familiar demo',
  push: push.host,
})
