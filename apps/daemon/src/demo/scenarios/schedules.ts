import {
  fauxAssistantMessage,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux'
import { localMinute } from '@familiar/core'
import type { Scenario } from '../types.ts'
import { DEMO_TIME_ZONE } from '../zone.ts'

/** The next whole minute, as the schedule tool's `YYYY-MM-DD HH:MM`. */
const nextMinute = () => localMinute(Date.now() + 60_000, DEMO_TIME_ZONE)

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
