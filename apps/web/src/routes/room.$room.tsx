import { createFileRoute } from '@tanstack/react-router'
import { RoomView } from '@/components/room-view'

/** A named room, by its ID. */
const NamedRoom = () => <RoomView id={Number(Route.useParams().room)} />

export const Route = createFileRoute('/room/$room')({ component: NamedRoom })
