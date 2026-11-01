import type { FamiliarPlugin } from '@familiar-ai/core'
import { convertHtml, type ConvertHtml } from './convert-html.ts'
import { webFetchTool } from './fetch-page.ts'
import { BRAVE_ORIGIN, BRAVE_PATH, webSearchTool } from './brave.ts'

/** Hosts can isolate synchronous conversion using their own runtime's limits. */
export const webPlugin = ({
  convert = async (html, url, maxChars) => convertHtml(html, url, maxChars),
}: { convert?: ConvertHtml } = {}): FamiliarPlugin => ({
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
      webFetchTool(context.fetch, convert, context.timeZone),
    ],
  }),
})

export default webPlugin()
