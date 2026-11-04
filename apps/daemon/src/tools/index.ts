import type { FamiliarPlugin } from '@familiar-ai/core'
import Piscina from 'piscina'
import { webFetchTool } from './fetch-page.ts'
import { BRAVE_ORIGIN, BRAVE_PATH, webSearchTool } from './brave.ts'

// Synchronous HTML conversion must not block the daemon; Piscina owns its limits.
const pages = new Piscina({
  filename: new URL(
    import.meta.url.endsWith('.ts') ? '../page-worker.ts' : './page-worker.js',
    import.meta.url,
  ).href,
  minThreads: 0,
  maxThreads: 2,
  maxQueue: 8,
  resourceLimits: { maxOldGenerationSizeMb: 128 },
})

/** Daemon defaults. Keep the connection identity stable for saved Brave keys. */
export const webTools: FamiliarPlugin = {
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
  extension: (context) => ({
    tools: [
      webSearchTool(context),
      webFetchTool(
        context.fetch,
        (html, url, maxChars, signal) =>
          pages.run({ html, url, maxChars }, { signal }),
        context.timeZone,
      ),
    ],
  }),
}
