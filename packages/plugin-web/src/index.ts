import { defineExtension } from '@earendil-works/pi-durable'
import { definePlugin } from '@familiar/core'
import { BRAVE_ORIGIN, BRAVE_PATH, braveSearch } from './brave.ts'
import { webFetchTool } from './fetch-page.ts'
import { htmlToMarkdown, type Convert } from './markdown.ts'
import { webSearchTool } from './search.ts'

export type { Convert, ConvertOptions, Page } from './markdown.ts'
export type { SearchRequest, SearchResult, SearchService } from './search.ts'

export type WebPluginOptions = {
  /**
   * How `web_fetch` turns HTML into Markdown. By default in the host's own
   * thread, which suits a host that bounds each request's CPU, such as a
   * Cloudflare Worker. A host without such a limit passes one that isolates
   * `htmlToMarkdown`, from `@familiar/plugin-web/markdown`.
   */
  convert?: Convert
}

/**
 * Web search and reading: `web_search` through Brave, which needs the
 * owner's key, and `web_fetch` for public pages through the host's guarded
 * fetch, which needs nothing.
 */
export const webPlugin = ({
  convert = async (html, url, options) => htmlToMarkdown(html, url, options),
}: WebPluginOptions = {}) =>
  definePlugin({
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
        tools: [
          webSearchTool(braveSearch(context)),
          webFetchTool(context.fetch, convert),
        ],
      }),
  })

/** The plugin, converting pages in the host's own thread. */
export default webPlugin()
