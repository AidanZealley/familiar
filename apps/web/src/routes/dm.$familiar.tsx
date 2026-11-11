import { createFileRoute } from '@tanstack/react-router'
import { PaneStatus } from '@/components/pane-status'
import { RoomView } from '@/components/room-view'
import { workspace } from '@/lib/familiar'

/** The person's DM with a Familiar, by the Familiar's ID: made on first visit. */
const Dm = () => <RoomView id={Route.useLoaderData()} />

export const Route = createFileRoute('/dm/$familiar')({
  loader: ({ params }) => workspace.familiars.dm(Number(params.familiar)),
  component: Dm,
  pendingComponent: () => <PaneStatus />,
  errorComponent: ({ error }) => (
    <PaneStatus
      problem={`Couldn't open this DM. ${(error as Error).message}`}
    />
  ),
})
