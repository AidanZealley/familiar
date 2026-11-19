import { createFileRoute } from '@tanstack/react-router'
import { NaturalRoomsPrototype } from '@/components/natural-rooms-prototype'

/** Stage 3 design variants for natural rooms. Removed once one is chosen. */
export const Route = createFileRoute('/prototypes/natural-rooms')({
  component: NaturalRoomsPrototype,
})
