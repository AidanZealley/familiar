import { definePlugin, defineTool, Type } from '@familiar-ai/core'
import {
  BoardError,
  STATUS_LABELS,
  STATUSES,
  type Board,
  type Task,
} from '../board/board.ts'

const status = Type.Union(
  [Type.Literal('todo'), Type.Literal('in_progress'), Type.Literal('done')],
  { description: 'todo, in_progress or done' },
)
const taskId = Type.String({ description: 'The task ID, such as T-3' })

export const describeTask = (task: Task) =>
  `${task.id} "${task.title}" (${STATUS_LABELS[task.status]}, ${
    task.assignee ? `assigned to ${task.assignee.name}` : 'unassigned'
  })`

/**
 * What the model reads (`output`) and what a UI can render (`details`). A
 * refused change becomes an error result the model can explain.
 */
const result = (text: string, details: { tasks: Task[] }) => ({
  output: [{ type: 'text' as const, text }],
  details,
})
const run = (change: () => { text: string; tasks: Task[] }) => {
  try {
    const { text, tasks } = change()
    return result(text, { tasks })
  } catch (error) {
    if (error instanceof BoardError) {
      return { ...result(error.message, { tasks: [] }), isError: true }
    }
    throw error
  }
}

/** Familiar's tools over the host's board. Each calls a board operation. */
export const boardPlugin = (board: Board) =>
  definePlugin({
    name: 'task-board',
    title: 'Task board',
    extension: () => ({
      tools: [
        defineTool({
          name: 'list_tasks',
          description:
            'Lists the tasks on the board, optionally only those with one status.',
          parameters: Type.Object({ status: Type.Optional(status) }),
          replay: 'safe',
          execute: async ({ status }) =>
            run(() => {
              // Column by column, in board order.
              const tasks = STATUSES.filter(
                (column) => !status || column === status,
              ).flatMap((column) =>
                board.tasks().filter((task) => task.status === column),
              )
              const heading = status ? STATUS_LABELS[status] : 'Board'
              return {
                text: tasks.length
                  ? `${heading}:\n${tasks.map((task) => `- ${describeTask(task)}`).join('\n')}`
                  : `${heading}: no tasks.`,
                tasks,
              }
            }),
        }),
        defineTool({
          name: 'create_task',
          description:
            'Adds a task to the board, in Todo unless told otherwise.',
          parameters: Type.Object({
            title: Type.String(),
            status: Type.Optional(status),
          }),
          execute: async ({ title, status }) =>
            run(() => {
              const task = board.create(title, status)
              return { text: `Created ${describeTask(task)}.`, tasks: [task] }
            }),
        }),
        defineTool({
          name: 'assign_task_to_me',
          description: 'Assigns a task to the person asking.',
          parameters: Type.Object({ taskId }),
          execute: async ({ taskId }, { invoker }) =>
            run(() => {
              // The host's authenticated author, never a tool argument.
              if (invoker.kind !== 'person') {
                throw new BoardError(
                  'Nobody asked, so there is no one to assign.',
                )
              }
              const task = board.assign(taskId, invoker.author)
              return { text: `Assigned ${describeTask(task)}.`, tasks: [task] }
            }),
        }),
        defineTool({
          name: 'move_task',
          description: 'Moves a task to another status column.',
          parameters: Type.Object({ taskId, status }),
          execute: async ({ taskId, status }) =>
            run(() => {
              const task = board.move(taskId, status)
              return { text: `Moved ${describeTask(task)}.`, tasks: [task] }
            }),
        }),
      ],
    }),
  })
