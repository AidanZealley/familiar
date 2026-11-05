import { useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import {
  Kanban,
  KanbanBoard,
  KanbanColumn,
  KanbanColumnContent,
  KanbanItem,
  KanbanOverlay,
} from '@/components/reui/kanban'
import { STATUS_LABELS, STATUSES, type Status, type Task } from '@/board/board'
import { useStore } from 'zustand'
import { useBoard } from '@/board/react'
import { NewTaskForm } from './components/new-task-form'
import { TaskCard } from './components/task-card'

// Item drops arrive through onMove, and columns have no drag handle, so the
// board never hands back a whole new arrangement.
const ignoreArrangement = () => {}

export const TaskBoard = () => {
  const board = useBoard()
  const tasks = useStore(board.store, (state) => state.tasks)
  const columns = useMemo(
    () =>
      Object.fromEntries(
        STATUSES.map((status) => [
          status,
          tasks.filter((task) => task.status === status),
        ]),
      ) as Record<Status, Task[]>,
    [tasks],
  )

  return (
    <Kanban
      value={columns}
      onValueChange={ignoreArrangement}
      getItemValue={(task) => task.id}
      onMove={({ event, overContainer, overIndex }) =>
        board.move(String(event.active.id), overContainer as Status, overIndex)
      }
    >
      <KanbanBoard className="auto-rows-auto">
        {STATUSES.map((status) => (
          <KanbanColumn
            key={status}
            value={status}
            className="gap-2 bg-muted/60 p-2 ring-1 ring-foreground/5"
          >
            <div className="flex items-center gap-2 px-1 py-0.5">
              <h2 className="font-heading text-xs font-medium">
                {STATUS_LABELS[status]}
              </h2>
              <Badge variant="secondary">{columns[status].length}</Badge>
            </div>
            {status === 'todo' && <NewTaskForm />}
            <KanbanColumnContent value={status} className="min-h-16">
              {columns[status].map((task) => (
                // The grip handle is the card's only drag control, so the
                // item isn't a focusable button too.
                <KanbanItem
                  key={task.id}
                  value={task.id}
                  role="group"
                  tabIndex={-1}
                  aria-roledescription={undefined}
                  aria-describedby={undefined}
                >
                  <TaskCard task={task} />
                </KanbanItem>
              ))}
            </KanbanColumnContent>
          </KanbanColumn>
        ))}
      </KanbanBoard>
      <KanbanOverlay>
        <div className="size-full bg-primary/10 ring-1 ring-primary/30" />
      </KanbanOverlay>
    </Kanban>
  )
}
