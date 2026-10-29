import { defineExtension } from '@earendil-works/pi-durable'
import { definePlugin } from '@familiar/core'
import { BRAVE_ORIGIN, BRAVE_PATH, braveSearch } from './brave.ts'
import { webSearchTool } from './search.ts'

export type { SearchRequest, SearchResult, SearchService } from './search.ts'

/** Web search through Brave, using the owner's key. */
const webPlugin = definePlugin({
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
  extension: (context) =>
    defineExtension({
      name: 'web',
      tools: [webSearchTool(braveSearch(context))],
    }),
})

export default webPlugin
