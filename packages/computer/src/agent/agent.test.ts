import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer, type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
} from '@modelcontextprotocol/client'
import { expect, onTestFinished, test } from 'vitest'
import { startAgent } from './index.ts'

/** A port nothing listens on. */
const freePort = () =>
  new Promise<number>((done) => {
    const server = createServer().listen(0, () => {
      const { port } = server.address() as AddressInfo
      server.close(() => done(port))
    })
  })

const textOf = (result: CallToolResult) =>
  result.content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join()

// Cloudflare reaches the agent over HTTP, a client per call; the browser
// isn't needed for this, so it never starts.
test('the agent serves its tools over HTTP, and a call whose request drops stops', async () => {
  const home = await mkdtemp(join(tmpdir(), 'familiar-agent-'))
  const port = await freePort()
  const agent = await startAgent({ port, dataDir: home, home })
  onTestFinished(async () => {
    await agent.stop()
    await rm(home, { recursive: true, force: true })
  })
  const connect = async () => {
    const client = new Client(
      { name: 'test', version: '1.0.0' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    )
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/`)),
    )
    onTestFinished(() => client.close())
    return client
  }

  const result = (await (
    await connect()
  ).callTool({
    name: 'run_command',
    arguments: { command: 'echo hello > greeting; cat greeting' },
  })) as CallToolResult
  expect(textOf(result)).toBe('hello\n\nExit code 0.')

  // Writes a file only if it runs for a second without being stopped.
  const stopped = new AbortController()
  const call = (await connect()).callTool(
    { name: 'run_command', arguments: { command: 'sleep 1; echo ran > ran' } },
    { signal: stopped.signal },
  )
  setTimeout(() => stopped.abort(), 200)
  await expect(call).rejects.toThrow()
  await new Promise((done) => setTimeout(done, 1500))
  await expect(readFile(join(home, 'ran'), 'utf8')).rejects.toThrow()
})
