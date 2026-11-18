import { createFileRoute } from '@tanstack/react-router'
import { RoomView } from '@/components/room-view'
import { computerViewSearch } from '@/lib/computer-view'
import { workspace } from '@/lib/familiar'

/** The person's DM with a Familiar, by the Familiar's ID: made on first visit. */
const Dm = () => <RoomView id={Route.useLoaderData()} />

// Loading and failing show the router's defaults, in the pane.
export const Route = createFileRoute('/dm/$familiar')({
  validateSearch: computerViewSearch,
  loader: ({ params }) => workspace.familiars.dm(Number(params.familiar)),
  component: Dm,
})
