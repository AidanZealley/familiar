import { describe, expect, it, vi } from 'vitest'
import { startDemo, type Client, type Demo } from './demo.ts'
import { PEOPLE } from './people.ts'
import { UNSUPPORTED_REPLY } from './script.ts'

const open = async () => {
  const demo = await startDemo(PEOPLE)
  await vi.waitFor(() => {
    for (const { store } of demo.clients) {
      expect(store.getState().connection).toBe('open')
    }
  })
  return demo
}

const items = ({ store }: Client) => store.getState().transcript?.items ?? []
const toolCalls = (client: Client) =>
  items(client).flatMap((item) => (item.type === 'reply' ? item.toolCalls : []))
const replies = (client: Client) =>
  items(client).flatMap((item) => (item.type === 'reply' ? [item.text] : []))
/** Waits until Familiar and this client's mirror of it have both settled. */
const settle = async ({ familiar }: Demo, client: Client) => {
  await familiar.idle()
  await vi.waitFor(() => {
    const transcript = client.store.getState().transcript
    expect(transcript?.busy).toBe(false)
    expect(transcript?.items.at(-1)).toMatchObject({
      type: 'reply',
      streaming: false,
    })
  })
}

/** Sends as this client's person and waits for the reply. */
const ask = async (demo: Demo, client: Client, text: string) => {
  await client.store.conversation.send(text)
  await settle(demo, client)
  return replies(client).at(-1)
}

describe('shared conversation demo', () => {
  it("answers from an earlier person's words in the model's input", async () => {
    const demo = await open()
    const [anaClient, benClient, chloeClient] = demo.clients
    try {
      await ask(demo, anaClient, 'Note for the group: I can bring tiramisu')
      await ask(demo, benClient, 'Note for the group: Friday works for me')
      expect(await ask(demo, chloeClient, 'What did Ana say?')).toBe(
        'Ana said: "Note for the group: I can bring tiramisu"\n\n' +
          'The script found that in the conversation Familiar sent with this request. ' +
          "It isn't long-term memory.",
      )
      expect(await ask(demo, chloeClient, 'What did Dana say?')).toBe(
        "I can't see a message from Dana in this conversation yet.",
      )
    } finally {
      await demo.stop()
    }
  })

  it('does not add the same guest twice', async () => {
    const demo = await open()
    const [anaClient] = demo.clients
    try {
      expect(await ask(demo, anaClient, 'Count me in')).toBe(
        'Counted Ana in. Going: Ana.',
      )
      expect(await ask(demo, anaClient, 'Count me in')).toBe(
        'Ana was already counted in. Going: Ana.',
      )
    } finally {
      await demo.stop()
    }
  })

  it.each([
    "Don't count me in",
    'Count me in and Ben too',
    'Who am I and who is coming?',
    'Count Chloe in',
    'Write me a poem',
  ])('falls back without running a tool: %s', async (prompt) => {
    const demo = await open()
    const [, , chloeClient] = demo.clients
    try {
      expect(await ask(demo, chloeClient, prompt)).toBe(UNSUPPORTED_REPLY)
      expect(toolCalls(chloeClient)).toEqual([])
    } finally {
      await demo.stop()
    }
  })

  it('closes every stream and refuses ended sessions on stop', async () => {
    const demo = await open()
    const [anaClient] = demo.clients
    await demo.stop()
    // Everyone's stream is closed, and nothing reconnects it.
    for (const { store } of demo.clients) {
      expect(store.getState().connection).not.toBe('reconnecting')
    }
    await expect(
      anaClient.store.conversation.send('Count me in'),
    ).rejects.toThrow()
    // A fresh start shares nothing with the last.
    const next = await open()
    try {
      expect(next.clients.map(items)).toEqual([[], [], []])
      expect(await ask(next, next.clients[1], 'Count me in')).toBe(
        'Counted Ben in. Going: Ben.',
      )
    } finally {
      await next.stop()
    }
  })
})
