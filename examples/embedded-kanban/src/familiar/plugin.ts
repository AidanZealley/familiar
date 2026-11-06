import { definePlugin, defineTool, familiar, Type } from '@familiar-ai/core'
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

const describeTask = (task: Task) =>
  `${task.id} "${task.title}" (${STATUS_LABELS[task.status]}, ${
    task.assignee ? `assigned to ${task.assignee.name}` : 'unassigned'
  })`

/**
 * What the model reads. A change the board refuses becomes an error result
 * the model can explain; anything else that throws is a real failure.
 */
const run = async (change: () => string) => {
  try {
    return { output: [{ type: 'text' as const, text: change() }] }
  } catch (error) {
    if (!(error instanceof BoardError)) {
      throw error
    }
    return {
      output: [{ type: 'text' as const, text: error.message }],
      isError: true,
    }
  }
}

/** Familiar's tools over the host's board. Each calls a board operation. */
export const boardPlugin = (board: Board) =>
  definePlugin({
    name: 'task-board',
    title: 'Task board',
    tools: [
      defineTool({
        name: 'list_tasks',
        description:
          'Lists the tasks on the board, optionally only those with one status.',
        parameters: Type.Object({ status: Type.Optional(status) }),
        replay: 'safe',
        execute: ({ status }) =>
          run(() => {
            // Column by column, in board order.
            const tasks = STATUSES.filter(
              (column) => !status || column === status,
            ).flatMap((column) =>
              board.tasks().filter((task) => task.status === column),
            )
            const heading = status ? STATUS_LABELS[status] : 'Board'
            return tasks.length
              ? `${heading}:\n${tasks.map((task) => `- ${describeTask(task)}`).join('\n')}`
              : `${heading}: no tasks.`
          }),
      }),
      defineTool({
        name: 'create_task',
        description: 'Adds a task to the board, in Todo.',
        parameters: Type.Object({ title: Type.String() }),
        execute: ({ title }) =>
          run(() => `Created ${describeTask(board.create(title))}.`),
      }),
      defineTool({
        name: 'assign_task_to_me',
        description: 'Assigns a task to the person asking.',
        parameters: Type.Object({ taskId }),
        execute: async ({ taskId }, _api, context) => {
          // The person who asked, never a tool argument. Undefined for
          // work nobody asked for, such as memory upkeep.
          const author = await familiar(context).author()
          return run(() => {
            if (!author) {
              throw new BoardError(
                'Nobody asked, so there is no one to assign.',
              )
            }
            return `Assigned ${describeTask(board.assign(taskId, author))}.`
          })
        },
      }),
      defineTool({
        name: 'move_task',
        description: 'Moves a task to another status column.',
        parameters: Type.Object({ taskId, status }),
        execute: ({ taskId, status }) =>
          run(() => `Moved ${describeTask(board.move(taskId, status))}.`),
      }),
    ],
  })
