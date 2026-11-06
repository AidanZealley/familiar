import { definePlugin } from '@familiar-ai/core'
import { webFetchTool } from './fetch.ts'
import { BRAVE_ORIGIN, BRAVE_PATH, webSearchTool } from './search.ts'

/** Daemon defaults. Keep the connection identity stable for saved Brave keys. */
export const webPlugin = definePlugin({
  name: 'web',
  title: 'Web search',
  secrets: [
    {
      name: 'braveApiKey',
      label: 'Brave Search API key',
      help: 'From the API keys page of your Brave Search API dashboard, https://api-dashboard.search.brave.com/app/keys. Any plan with Web Search works.',
      sendAs: {
        header: 'X-Subscription-Token',
        origin: BRAVE_ORIGIN,
        requests: [{ method: 'GET', path: BRAVE_PATH }],
      },
    },
  ],
  tools: [webSearchTool, webFetchTool],
})
