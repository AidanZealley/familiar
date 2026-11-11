import type { RoomSummary } from '@familiar-ai/client'
import type { liveOf } from '../../live'

export type ConversationStatusProps = {
  room: RoomSummary
  live: ReturnType<typeof liveOf>
}
