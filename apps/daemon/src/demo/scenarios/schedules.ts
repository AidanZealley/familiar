import {
  fauxAssistantMessage,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux'
import type { Scenario } from '../types.ts'

const pad = (value: number) => String(value).padStart(2, '0')

/** The next whole minute, as the schedule tool's local `YYYY-MM-DD HH:MM`. */
function nextMinute() {
  const at = new Date(Date.now() + 60_000)
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`
}

export const remind: Scenario = {
  start: () =>
    fauxAssistantMessage(
      fauxToolCall('schedule', {
        prompt: 'Remind the owner to stand up and stretch',
        at: nextMinute(),
      }),
      { stopReason: 'toolUse' },
    ),
  replies: {
    schedule: (output) =>
      fauxAssistantMessage(`I'll remind you within a minute. ${output}`),
  },
}

export const scheduledReply = () =>
  fauxAssistantMessage(
    "**Time to stretch!** You've been sitting a while: stand up, roll your shoulders and look at something far away for a minute.",
  )
