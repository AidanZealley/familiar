import { definePlugin, defineTool, Type } from '@familiar-ai/core'

export const greeting = definePlugin({
  name: 'greeting',
  title: 'Greeting',
  extension: () => ({
    tools: [
      defineTool({
        name: 'greet',
        description: 'Greet the person who asked.',
        parameters: Type.Object({}),
        // Repeating this tool after a crash has no outside effect.
        replay: 'safe',
        execute: async (_args, api) => ({
          output: [
            { type: 'text', text: `Hello, ${api.author?.name ?? 'there'}.` },
          ],
        }),
      }),
    ],
  }),
})
