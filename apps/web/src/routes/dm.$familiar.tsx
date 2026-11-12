import { createFileRoute } from '@tanstack/react-router'
import { RoomView } from '@/components/room-view'
import { workspace } from '@/lib/familiar'

/** The person's DM with a Familiar, by the Familiar's ID: made on first visit. */
const Dm = () => <RoomView id={Route.useLoaderData()} />

// Loading and failing show the router's defaults, in the pane.
export const Route = createFileRoute('/dm/$familiar')({
  loader: ({ params }) => workspace.familiars.dm(Number(params.familiar)),
  component: Dm,
})
