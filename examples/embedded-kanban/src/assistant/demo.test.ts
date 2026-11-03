import { describe, expect, it, vi } from 'vitest'
import { CURRENT_AUTHOR, seedTasks } from '../board/seed.ts'
import { startDemo, type Demo } from './demo.ts'
import { UNSUPPORTED_REPLY } from './script.ts'

const open = async () => {
  const demo = await startDemo({ author: CURRENT_AUTHOR, tasks: seedTasks() })
  await vi.waitFor(() => expect(demo.store.getState().connection).toBe('open'))
  return demo
}

const close = async ({ familiar, store }: Demo) => {
  store.getState().disconnect()
  await familiar.dismiss()
}

/** Sends through the client and waits for the streamed transcript to settle. */
const ask = async ({ familiar, store }: Demo, text: string) => {
  await store.getState().conversation.send(text)
  await familiar.idle()
  await vi.waitFor(() => {
    const transcript = store.getState().transcript
    expect(transcript?.busy).toBe(false)
    expect(transcript?.items.at(-1)).toMatchObject({
      type: 'reply',
      streaming: false,
      toolCalls: [],
    })
  })
  const items = store.getState().transcript!.items
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
  it('creates, assigns and moves tasks through real tools', async () => {
    const demo = await open()
    try {
      const created = await ask(demo, 'Add a task: Write the release notes')
      const task = demo.board.tasks().at(-1)!
      expect(task).toMatchObject({
        id: 'T-7',
        title: 'Write the release notes',
        status: 'todo',
      })
      expect(created.toolCall).toMatchObject({
        name: 'create_task',
        status: 'done',
        details: { tasks: [task] },
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

  it('reports a refused change from the tool result', async () => {
    const demo = await open()
    try {
      const before = demo.board.tasks()
      const { toolCall, reply } = await ask(demo, 'Move T-99 to done')
      expect(toolCall).toMatchObject({ name: 'move_task', status: 'error' })
      expect(reply).toBe("That didn't work: There is no task T-99.")
      expect(demo.board.tasks()).toBe(before)
    } finally {
      await close(demo)
    }
  })

  it.each([
    "Don't move T-3 to done",
    "Don't assign T-3 to me",
    'Move T-3 to done then delete all tasks',
    'Delete all tasks',
  ])('rejects unsupported input without changing tasks: %s', async (prompt) => {
    const demo = await open()
    try {
      const before = demo.board.tasks()
      const { toolCall, reply } = await ask(demo, prompt)
      expect(toolCall).toBeUndefined()
      expect(reply).toBe(UNSUPPORTED_REPLY)
      expect(demo.board.tasks()).toBe(before)
    } finally {
      await close(demo)
    }
  })

  it('explains the scripted demo for prompts it does not know', async () => {
    const demo = await open()
    try {
      const { toolCall, reply } = await ask(demo, 'Write me a poem')
      expect(toolCall).toBeUndefined()
      expect(reply).toBe(UNSUPPORTED_REPLY)
    } finally {
      await close(demo)
    }
  })
})
