import { describe, expect, it } from 'vitest'
import { BoardError, createBoard, type Status } from './board.ts'

const board = () =>
  createBoard([
    { id: 'T-1', title: 'One', status: 'todo' },
    { id: 'T-2', title: 'Two', status: 'todo' },
    { id: 'T-3', title: 'Three', status: 'todo' },
    { id: 'T-4', title: 'Four', status: 'done' },
  ])
const column = (b: ReturnType<typeof board>, status: Status) =>
  b
    .tasks()
    .filter((task) => task.status === status)
    .map((task) => task.id)

describe('board.move', () => {
  // Indexes are where a drop lands, as the board UI reports them.
  it('reorders within a column', () => {
    const b = board()
    b.move('T-1', 'todo', 2)
    expect(column(b, 'todo')).toEqual(['T-2', 'T-3', 'T-1'])
    b.move('T-1', 'todo', 0)
    expect(column(b, 'todo')).toEqual(['T-1', 'T-2', 'T-3'])
  })

  it('inserts into another column, or appends without an index', () => {
    const b = board()
    b.move('T-2', 'done', 0)
    expect(column(b, 'done')).toEqual(['T-2', 'T-4'])
    b.move('T-3', 'done')
    expect(column(b, 'done')).toEqual(['T-2', 'T-4', 'T-3'])
    expect(column(b, 'todo')).toEqual(['T-1'])
  })

  it('refuses unknown tasks without changing anything', () => {
    const b = board()
    const before = b.tasks()
    expect(() => b.move('T-9', 'done')).toThrow(BoardError)
    expect(b.tasks()).toBe(before)
  })
})
