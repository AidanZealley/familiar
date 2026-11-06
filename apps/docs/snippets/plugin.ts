import { definePlugin, defineTool, familiar, Type } from '@familiar-ai/core'

export const greeting = definePlugin({
  name: 'greeting',
  title: 'Greeting',
  tools: [
    defineTool({
      name: 'greet',
      description: 'Greet the person who asked.',
      parameters: Type.Object({}),
      // Repeating this tool after a crash has no outside effect.
      replay: 'safe',
      execute: async (_args, _api, context) => {
        const author = await familiar(context).author()
        return {
          output: [
            { type: 'text', text: `Hello, ${author?.name ?? 'there'}.` },
          ],
        }
      },
    }),
  ],
})
