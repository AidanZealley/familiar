import { describe, expect, it, vi } from 'vitest'
import { startDemo, type Client, type Demo } from './demo.ts'
import { UNSUPPORTED_REPLY } from './script.ts'

const open = async () => {
  const demo = await startDemo()
  await vi.waitFor(() => {
    for (const { store } of demo.clients) {
      expect(store.getState().connection).toBe('open')
    }
  })
  return demo
}

const close = async ({ familiar, clients }: Demo) => {
  for (const { store } of clients) {
    store.disconnect()
  }
  await familiar.dismiss()
}

const items = ({ store }: Client) => store.getState().transcript?.items ?? []
const replies = (client: Client) =>
  items(client).flatMap((item) =>
    item.type === 'reply' && item.text ? [item.text] : [],
  )

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
    const [ana, ben, chloe] = demo.clients
    try {
      await ask(demo, ana, 'Note for the group: I can bring tiramisu')
      await ask(demo, ben, 'Note for the group: Friday works for me')
      expect(await ask(demo, chloe, 'What did Ana say?')).toBe(
        'Ana said: "Note for the group: I can bring tiramisu"\n\n' +
          'The script found that in the conversation Familiar sent with this request. ' +
          "It isn't long-term memory.",
      )
      expect(await ask(demo, chloe, 'What did Dana say?')).toBe(
        "I can't see a message from Dana in this conversation yet.",
      )
    } finally {
      await close(demo)
    }
  })

  it("runs a message queued during someone else's reply as its own sender", async () => {
    const demo = await open()
    const [ana, ben] = demo.clients
    try {
      await ana.store.conversation.send('Count me in')
      // Sending resolves once Familiar has the message, so Ana's run is
      // still going when Ben's arrives.
      await ben.store.conversation.send('Count me in')
      await settle(demo, ben)
      expect(replies(ben).slice(-2)).toEqual([
        'Counted Ana in. Going: Ana.',
        'Counted Ben in. Going: Ana, Ben.',
      ])
    } finally {
      await close(demo)
    }
  })

  it('runs no tool for anything the script does not know', async () => {
    const demo = await open()
    const [, , chloe] = demo.clients
    try {
      for (const prompt of [
        "Don't count me in",
        'Count me in and Ben too',
        'Write me a poem',
      ]) {
        expect(await ask(demo, chloe, prompt), prompt).toBe(UNSUPPORTED_REPLY)
      }
      const toolCalls = items(chloe).flatMap((item) =>
        item.type === 'reply' ? item.toolCalls : [],
      )
      expect(toolCalls).toEqual([])
    } finally {
      await close(demo)
    }
  })
})
