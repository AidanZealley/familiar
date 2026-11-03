import { createContext, useContext, type ReactNode } from 'react'
import { useStore } from 'zustand'
import type { Board, Task } from './board.ts'

const BoardContext = createContext<Board | undefined>(undefined)

export const BoardProvider = ({
  board,
  children,
}: {
  board: Board
  children: ReactNode
}) => <BoardContext value={board}>{children}</BoardContext>

/** The board's operations. Components change tasks only through these. */
export const useBoard = () => {
  const board = useContext(BoardContext)
  if (!board) {
    throw new Error('useBoard needs a BoardProvider')
  }
  return board
}

export const useTasks = (): Task[] => useStore(useBoard().store, (s) => s.tasks)
