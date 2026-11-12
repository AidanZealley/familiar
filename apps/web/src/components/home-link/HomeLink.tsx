import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'

/**
 * Back to the list of conversations, on a phone only: a problem that
 * replaces the conversation leaves no header with Back. A wide screen
 * shows the sidebar beside it.
 */
export const HomeLink = () => (
  <Button
    variant="outline"
    className="md:hidden"
    nativeButton={false}
    render={<Link to="/" />}
  >
    All conversations
  </Button>
)
