import type { Author } from '@familiar-ai/core'
import { createStore } from 'zustand/vanilla'

export const STATUSES = ['todo', 'in_progress', 'done'] as const
export type Status = (typeof STATUSES)[number]

export const STATUS_LABELS: Record<Status, string> = {
  todo: 'Todo',
  in_progress: 'In progress',
  done: 'Done',
}

export type Task = {
  id: string
  title: string
  status: Status
  assignee?: Author
}

/** A request the board refuses, such as an unknown task. Nothing changes. */
export class BoardError extends Error {}

/**
 * The host's task board: the only place tasks live and change. The board UI
 * and Familiar's tools both call these operations, so a change made either way
 * shows up in the other.
 */
export function createBoard(seed: Task[]) {
  const store = createStore<{ tasks: Task[] }>(() => ({ tasks: seed }))

  const tasks = () => store.getState().tasks
  const find = (id: string) => {
    const task = tasks().find((task) => task.id === id)
    if (!task) {
      throw new BoardError(`There is no task ${id}.`)
    }
    return task
  }

  return {
    store,
    tasks,
    find,

    create(title: string) {
      const trimmed = title.trim()
      if (!trimmed) {
        throw new BoardError('A task needs a title.')
      }
      // Tasks are never deleted, so the count numbers the next one.
      const task: Task = {
        id: `T-${tasks().length + 1}`,
        title: trimmed,
        status: 'todo',
      }
      store.setState({ tasks: [...tasks(), task] })
      return task
    },

    assign(id: string, assignee: Author) {
      const task = { ...find(id), assignee }
      store.setState({
        tasks: tasks().map((other) => (other.id === id ? task : other)),
      })
      return task
    },

    /** Moves a task to `status`, at `index` among that column's tasks. */
    move(id: string, status: Status, index?: number) {
      const task = { ...find(id), status }
      const rest = tasks().filter((other) => other.id !== task.id)
      const column = rest.filter((other) => other.status === status)
      const before = column[index ?? column.length]
      const at = before ? rest.indexOf(before) : rest.length
      store.setState({ tasks: [...rest.slice(0, at), task, ...rest.slice(at)] })
      return task
    },
  }
}

export type Board = ReturnType<typeof createBoard>
