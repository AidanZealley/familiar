import { GripVertical } from 'lucide-react'
import { KanbanItemHandle } from '@/components/reui/kanban'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useBoard } from '@/board/react'
import type { TaskCardProps } from './types'

export const TaskCard = ({ task, author }: TaskCardProps) => {
  const board = useBoard()
  const mine = task.assignee?.id === author.id

  return (
    <Card size="sm" className="gap-2 px-3">
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 font-medium">{task.title}</span>
        <span className="text-muted-foreground">{task.id}</span>
        <KanbanItemHandle
          render={<Button variant="ghost" size="icon-xs" />}
          aria-label={`Move ${task.id}`}
          aria-roledescription="sortable"
          className="touch-none"
        >
          <GripVertical aria-hidden="true" />
        </KanbanItemHandle>
      </div>
      <div className="flex min-h-6 items-center gap-2 text-muted-foreground">
        {task.assignee ? (
          <>
            <Avatar size="sm">
              <AvatarFallback>{task.assignee.name[0]}</AvatarFallback>
            </Avatar>
            <span>
              {mine ? `${task.assignee.name} (you)` : task.assignee.name}
            </span>
          </>
        ) : (
          <span>Unassigned</span>
        )}
        {!mine && (
          <Button
            variant="ghost"
            size="xs"
            className="ml-auto"
            onClick={() => board.assign(task.id, author)}
          >
            Assign to me
          </Button>
        )}
      </div>
    </Card>
  )
}
