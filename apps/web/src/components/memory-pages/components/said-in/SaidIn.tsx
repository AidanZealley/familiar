import { Link } from '@tanstack/react-router'
import { useRoomSummary } from '@/lib/workspace'
import type { SaidInProps } from './types'

/** "said by Maya in Kitchen", linking to the conversation when it's one you can open. */
export const SaidIn = ({ saidBy, room }: SaidInProps) => {
  const summary = useRoomSummary(room ?? -1)

  return (
    <>
      said by {saidBy.name}
      {summary && (
        <>
          {' in '}
          <Link
            to="/room/$room"
            params={{ room: String(summary.id) }}
            className="underline underline-offset-2"
          >
            {summary.kind === 'dm' ? 'a DM' : summary.name}
          </Link>
        </>
      )}
    </>
  )
}
