import type { GencnPhase } from 'gencn'
import { toolName } from '@/components/chat/components/tool-call/label'

/** What a card's line under it says for `phase`, if anything. */
export function cardStatus(phase: GencnPhase) {
  switch (phase.kind) {
    case 'running':
      return 'Working…'
    case 'reading':
      return 'Updating…'
    case 'idle':
      if (phase.notice?.code === 'failed') {
        const why = phase.notice.message ? `: ${phase.notice.message}` : '.'
        return `${toolName(phase.notice.tool)} didn't work${why}`
      }
      return undefined
    default:
      return undefined
  }
}
