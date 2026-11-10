import { describe, expect, it, vi } from 'vitest'
import { CURRENT_AUTHOR } from '../board/seed.ts'
import { startDemo, type Demo } from './demo.ts'
import { UNSUPPORTED_REPLY } from './script.ts'

const open = async () => {
  const demo = await startDemo()
  await vi.waitFor(() => expect(demo.store.getState().connection).toBe('open'))
  return demo
}

const close = async ({ workspace, store }: Demo) => {
  store.disconnect()
  await workspace.dismiss()
}

/** Sends through the client and waits for the streamed transcript to settle. */
const ask = async ({ store }: Demo, text: string) => {
  const before = store.getState().transcript?.items.length ?? 0
  await store.send(text)
  await vi.waitFor(() => {
    const transcript = store.getState().transcript
    // The message, then its reply, copied in once the turn ends.
    expect(transcript?.items.length).toBeGreaterThan(before + 1)
    expect(transcript?.busy).toBe(false)
    expect(transcript?.items.at(-1)).toMatchObject({
      type: 'reply',
      streaming: false,
      toolCalls: [],
    })
  })
  const items = store.getState().transcript!.items.slice(before)
  const toolCalls = items.flatMap((item) =>
    item.type === 'reply' ? item.toolCalls : [],
  )
  const last = items.at(-1)
  return {
    toolCall: toolCalls.at(-1),
    reply: last?.type === 'reply' ? last.text : undefined,
  }
}

describe('embedded kanban demo', () => {
  it('changes the board through real tools, and reports a refused change', async () => {
    const demo = await open()
    try {
      const created = await ask(demo, 'Add a task: Write the release notes')
      expect(demo.board.find('T-7')).toMatchObject({
        title: 'Write the release notes',
        status: 'todo',
      })
      expect(created.toolCall).toMatchObject({
        name: 'create_task',
        status: 'done',
      })
      expect(created.reply).toBe(created.toolCall!.output)

      await ask(demo, 'Assign T-7 to me')
      // The assignee comes from the authenticated author, not the arguments.
      expect(demo.board.find('T-7').assignee).toEqual(CURRENT_AUTHOR)

      const moved = await ask(demo, 'Move T-7 to in progress')
      expect(demo.board.find('T-7').status).toBe('in_progress')
      expect(moved.reply).toContain(
        'T-7 "Write the release notes" (In progress',
      )

      const before = demo.board.tasks()
      const refused = await ask(demo, 'Move T-99 to done')
      expect(refused.toolCall).toMatchObject({
        name: 'move_task',
        status: 'error',
      })
      expect(refused.reply).toBe("That didn't work: There is no task T-99.")
      expect(demo.board.tasks()).toBe(before)
    } finally {
      await close(demo)
    }
  })

  it('answers queries from the board the UI changes', async () => {
    const demo = await open()
    try {
      // What the board UI does on a drop and on "Assign to me".
      demo.board.move('T-1', 'done', 0)
      demo.board.assign('T-1', CURRENT_AUTHOR)
      const { toolCall, reply } = await ask(demo, "What's done?")
      expect(toolCall).toMatchObject({
        name: 'list_tasks',
        arguments: { status: 'done' },
      })
      expect(reply).toBe(
        'Done:\n- T-1 "Draft the launch checklist" (Done, assigned to Sam)\n' +
          '- T-6 "Set up error monitoring" (Done, assigned to Priya)',
      )
    } finally {
      await close(demo)
    }
  })

  it('runs no tool for anything the script does not know', async () => {
    const demo = await open()
    try {
      const before = demo.board.tasks()
      for (const prompt of [
        "Don't move T-3 to done",
        'Move T-3 to done then delete all tasks',
        'Write me a poem',
      ]) {
        const { toolCall, reply } = await ask(demo, prompt)
        expect(toolCall, prompt).toBeUndefined()
        expect(reply, prompt).toBe(UNSUPPORTED_REPLY)
      }
      expect(demo.board.tasks()).toBe(before)
    } finally {
      await close(demo)
    }
  })
})
