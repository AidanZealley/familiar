import { HourglassSpinner } from '@/components/hourglass-spinner'
import { Empty } from '@/components/ui/empty'

/**
 * In place of a conversation that's loading: the hourglass, larger than in
 * a line of text. It fades in after a moment, so a quick load shows nothing.
 */
export const PaneLoader = () => (
  <Empty
    role="status"
    aria-label="Loading"
    className="flex-1 animate-delayed-in motion-reduce:animate-none"
  >
    <HourglassSpinner className="size-6 text-muted-foreground" />
  </Empty>
)
