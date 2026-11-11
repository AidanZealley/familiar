import type { RoomSummary } from '@familiar-ai/client'
import type { Live } from '@/lib/workspace'

export type ConversationStatusProps = {
  room: RoomSummary
  live: Live
}
