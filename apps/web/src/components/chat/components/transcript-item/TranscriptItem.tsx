import { cn } from 'cn'
import { ClockIcon, MoonIcon } from '@phosphor-icons/react'
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker'
import { FamiliarLink } from '@/components/familiar-link'
import { HourglassSpinner } from '@/components/hourglass-spinner'
import { FamiliarTurn } from '../familiar-turn'
import { PersonMessage } from '../person-message'
import { Reply } from '../reply'
import { Thinking } from '../thinking'
import { Handoff } from './components/handoff'
import { RoomNote } from './components/room-note'
import { ScheduledPrompt } from './components/scheduled-prompt'
import type { TranscriptItemProps } from './types'

/**
 * One item. In a named room, a Familiar's replies sit beside its portrait,
 * named once per run, and its handoffs and quiet passes line up with them;
 * in a DM they take the full width. People's messages, notes and schedules
 * stand on their own, notes across the whole conversation.
 */
export const TranscriptItem = ({
  item,
  dm,
  lead,
  run,
  end,
}: TranscriptItemProps) => {
  // Clear of the portrait column, which a DM doesn't have.
  const gutter = cn(!dm && 'pl-10.5')

  switch (item.type) {
    case 'message':
      return <PersonMessage message={item} />
    case 'scheduled':
      return <ScheduledPrompt item={item} />
    case 'handoff':
      return (
        <div className={gutter}>
          <Handoff handoff={item} />
        </div>
      )
    case 'note':
      return <RoomNote note={item} />
    case 'waiting':
      return (
        <FamiliarTurn
          familiar={item.familiar}
          dm={dm}
          lead={item.familiar === lead}
          run={run}
          end={end}
        >
          {item.status === 'running' ? (
            <Thinking text="" active />
          ) : (
            <Marker role="status">
              <MarkerIcon>
                {item.status === 'queued' ? (
                  <ClockIcon />
                ) : (
                  <HourglassSpinner className="size-full" />
                )}
              </MarkerIcon>
              <MarkerContent>
                {item.status === 'queued'
                  ? 'Queued: answers once the turn ahead of it here finishes'
                  : 'Busy in another room: answers here next'}
              </MarkerContent>
            </Marker>
          )}
        </FamiliarTurn>
      )
    case 'reply':
      // Saying nothing is shown once, as a line of its own.
      if (item.quiet) {
        return (
          run && (
            <Marker className={gutter}>
              <MarkerIcon>
                <MoonIcon />
              </MarkerIcon>
              <MarkerContent>
                <FamiliarLink id={item.familiar} then={item.name} /> stayed
                quiet
              </MarkerContent>
            </Marker>
          )
        )
      }
      return (
        <FamiliarTurn
          familiar={item.familiar}
          then={item.name}
          dm={dm}
          lead={item.familiar === lead}
          run={run}
          end={end}
        >
          <Reply reply={item} />
        </FamiliarTurn>
      )
  }
}
