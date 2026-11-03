import { PlusIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useBoard } from '@/board/react'

export const NewTaskForm = () => {
  const board = useBoard()
  const [title, setTitle] = useState('')

  return (
    <form
      className="flex gap-1"
      onSubmit={(event) => {
        event.preventDefault()
        if (title.trim()) {
          board.create(title)
          setTitle('')
        }
      }}
    >
      <Input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="New task"
        aria-label="New task title"
        className="bg-background"
      />
      <Button type="submit" size="icon" variant="outline" aria-label="Add task">
        <PlusIcon />
      </Button>
    </form>
  )
}
