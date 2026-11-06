import { definePlugin, defineTool, familiar, Type } from '@familiar-ai/core'

type Task = { id: string; title: string }

export const tasks = definePlugin({
  name: 'tasks',
  title: 'Tasks',
  // The owner sets this on the Connections page. Plugin code never reads it.
  secrets: [
    {
      name: 'token',
      label: 'Tasks API token',
      sendAs: {
        header: 'Authorization',
        prefix: 'Bearer ',
        origin: 'https://api.tasks.example',
        requests: [{ method: 'GET', path: '/v1/tasks' }],
      },
    },
  ],
  tools: [
    defineTool({
      name: 'list_tasks',
      description: "List the owner's open tasks.",
      parameters: Type.Object({}),
      replay: 'safe',
      execute: async (_args, _api, context) => {
        const response = await familiar(context).authorizedFetch(
          'token',
          'https://api.tasks.example/v1/tasks',
          { signal: context.abortSignal },
        )
        if (!response.ok) {
          throw new Error(`Tasks answered ${response.status}.`)
        }
        const found = (await response.json()) as Task[]
        return {
          // The model reads the text; a UI can render `details`.
          output: [
            {
              type: 'text',
              text: found.map((task) => `- ${task.title}`).join('\n'),
            },
          ],
          details: { tasks: found },
        }
      },
    }),
  ],
})
