import { ClockIcon, HourglassIcon, MoonIcon } from 'lucide-react'
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker'
import { FamiliarLink } from '@/components/familiar-link'
import { FamiliarTurn } from '../familiar-turn'
import { PersonMessage } from '../person-message'
import { Reply } from '../reply'
import { Thinking } from '../thinking'
import { Handoff } from './components/handoff'
import { RoomNote } from './components/room-note'
import { ScheduledPrompt } from './components/scheduled-prompt'
import type { TranscriptItemProps } from './types'

/**
 * One item. A Familiar's replies sit beside its portrait, named once per run;
 * people's messages, handoffs, notes and schedules stand on their own.
 */
export const TranscriptItem = ({ item, run }: TranscriptItemProps) => {
  switch (item.type) {
    case 'message':
      return <PersonMessage message={item} />
    case 'scheduled':
      return <ScheduledPrompt item={item} />
    case 'handoff':
      return <Handoff handoff={item} />
    case 'note':
      return <RoomNote note={item} />
    case 'waiting':
      return (
        <FamiliarTurn familiar={item.familiar} run={run}>
          {item.status === 'running' ? (
            <Thinking text="" active />
          ) : (
            <Marker role="status">
              <MarkerIcon>
                {item.status === 'queued' ? <ClockIcon /> : <HourglassIcon />}
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
            <Marker className="pl-10.5">
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
        <FamiliarTurn familiar={item.familiar} then={item.name} run={run}>
          <Reply reply={item} />
        </FamiliarTurn>
      )
  }
}
