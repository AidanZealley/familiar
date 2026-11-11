import { setTimeout } from 'node:timers/promises'
import { Type, defineTool, definePlugin } from '@familiar-ai/core'
import { WATCH_MINUTES } from './story.ts'

/**
 * Spool's plugin. Watching a print takes a while, so the turn that asks
 * for it is still running when the demo opens: the sidebar shows Spool
 * answering, and its turns in other rooms waiting.
 */
const watchPrint = defineTool({
  name: 'watch_print',
  description:
    'Watches the printer’s camera until the print reaches a layer, then says how it looks.',
  parameters: Type.Object({
    layer: Type.Number({ description: 'The layer to wait for' }),
  }),
  execute: async ({ layer }, _api, context) => {
    await setTimeout(WATCH_MINUTES * 60_000, undefined, {
      signal: context.abortSignal,
    })
    return {
      output: [
        {
          type: 'text',
          text: `Layer ${layer} reached. The first layers are flat, with no lifting at the corners.`,
        },
      ],
    }
  },
})

export const workshopPlugin = definePlugin({
  name: 'workshop',
  title: 'Workshop',
  tools: [watchPrint],
})
