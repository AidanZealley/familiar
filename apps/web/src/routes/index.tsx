import { createFileRoute } from '@tanstack/react-router'
import { MessageSquareIcon } from 'lucide-react'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'

/** Beside the sidebar on a wide screen; a phone shows only the sidebar here. */
const Home = () => (
  <Empty className="flex-1">
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <MessageSquareIcon />
      </EmptyMedia>
      <EmptyTitle>Pick a Familiar or a room</EmptyTitle>
      <EmptyDescription>
        Talk to one Familiar in its DM, or to several in a room.
      </EmptyDescription>
    </EmptyHeader>
  </Empty>
)

export const Route = createFileRoute('/')({ component: Home })
