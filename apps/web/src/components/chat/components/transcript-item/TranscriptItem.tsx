import { cn } from 'cn'
import { MoonIcon } from '@phosphor-icons/react'
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker'
import { FamiliarLink } from '@/components/familiar-link'
import { FamiliarTurn } from '../familiar-turn'
import { PersonMessage } from '../person-message'
import { Reply } from '../reply'
import { Handoff } from './components/handoff'
import { ToolRun } from './components/tool-run'
import { TranscriptGap } from './components/transcript-gap'
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
  busy,
  run,
  end,
}: TranscriptItemProps) => {
  // Clear of the portrait column, which a DM doesn't have.
  const gutter = cn(!dm && 'pl-10.5')

  switch (item.type) {
    case 'gap':
      return <TranscriptGap gap={item.gap} />
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
    case 'tool-run':
      return (
        <div className={gutter}>
          <ToolRun run={item} />
        </div>
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
          busy={busy}
          dm={dm}
          showIdentity={run !== undefined}
          at={dm ? end?.time : run?.time}
        >
          <Reply reply={item} />
        </FamiliarTurn>
      )
  }
}
