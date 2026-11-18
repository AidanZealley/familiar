import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from '@familiar-ai/core/models/faux'
import type { Scenario } from './scenario.ts'

/**
 * Wakes the Familiar's computer, if it has one, and leaves a ticking clock
 * on its screen, so there's something to watch from its popover.
 */
export const computer: Scenario = {
  start: () =>
    fauxAssistantMessage(
      fauxToolCall('run_command', {
        command:
          "urxvt -geometry 60x12+120+90 -e sh -c 'while :; do clear; date; sleep 1; done' >/dev/null 2>&1 &",
      }),
      { stopReason: 'toolUse' },
    ),
  replies: {
    run_command: (output) =>
      fauxAssistantMessage(
        fauxText(
          /Exit code 0/.test(output)
            ? "There's a clock ticking on my screen: open my computer from the header to watch it."
            : `My computer couldn't do that: ${output}`,
        ),
      ),
  },
}
