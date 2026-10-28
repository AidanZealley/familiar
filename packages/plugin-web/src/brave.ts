import type { PluginContext } from '@familiar/core'
import type { SearchRequest, SearchResult, SearchService } from './search.ts'

export const BRAVE_ORIGIN = 'https://api.search.brave.com'
export const BRAVE_PATH = '/res/v1/web/search'

const FRESHNESS = { day: 'pd', week: 'pw', month: 'pm', year: 'py' } as const

// Brave refuses longer queries.
const MAX_QUERY = 600

// The fields read from Brave's response; it has many more.
type BraveResponse = {
  web?: {
    results?: {
      title?: string
      url?: string
      description?: string
      /** When the page was published or last changed, as an ISO date. */
      page_age?: string
      /** The same, for people: `2 days ago`, `March 3, 2024`. */
      age?: string
    }[]
  }
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

// Snippets are asked for without highlighting, but are still HTML-escaped.
const plainText = (html: string) =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
      if (name.startsWith('#')) {
        const code = Number(
          name[1].toLowerCase() === 'x' ? `0${name.slice(1)}` : name.slice(1),
        )
        return Number.isInteger(code) && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : entity
      }
      return ENTITIES[name.toLowerCase()] ?? entity
    })
    .trim()

/**
 * Brave's Web Search API. Its key goes only where the plugin declares it,
 * through `authorizedFetch`; this never sees it.
 */
export function braveSearch(context: PluginContext): SearchService {
  return {
    name: 'Brave Search',
    search: async (
      { query, count, freshness, domains }: SearchRequest,
      signal?: AbortSignal,
    ) => {
      const sites = domains.map((domain) => `site:${domain}`).join(' OR ')
      const q = sites ? `${query} ${sites}` : query
      if (q.length > MAX_QUERY) {
        throw new Error(
          `Brave Search takes queries of up to ${MAX_QUERY} characters, sites included.`,
        )
      }
      const url = new URL(BRAVE_PATH, BRAVE_ORIGIN)
      url.searchParams.set('q', q)
      url.searchParams.set('count', String(count))
      if (freshness) {
        url.searchParams.set('freshness', FRESHNESS[freshness])
      }
      url.searchParams.set('text_decorations', 'false')

      const response = await context.authorizedFetch('braveApiKey', url, {
        headers: { accept: 'application/json' },
        signal,
      })
      if (!response.ok) {
        throw new Error(await failure(response))
      }
      const body = (await response.json()) as BraveResponse
      return (body.web?.results ?? []).flatMap((result): SearchResult[] =>
        result.url
          ? [
              {
                title: plainText(result.title ?? '') || result.url,
                url: result.url,
                published: result.page_age?.slice(0, 10) || result.age,
                snippet: plainText(result.description ?? ''),
              },
            ]
          : [],
      )
    },
  }
}

async function failure(response: Response) {
  if (response.status === 401 || response.status === 403) {
    return 'Brave Search refused the key. Ask the owner to check the Brave Search API key on the Connections page.'
  }
  if (response.status === 429) {
    return "Brave Search's rate limit or monthly quota was reached. Try again later."
  }
  // Brave explains other refusals, such as a bad parameter, in `error.detail`.
  const detail = await response
    .json()
    .then((body) => (body as { error?: { detail?: unknown } }).error?.detail)
    .catch(() => undefined)
  return `Brave Search answered ${response.status}${typeof detail === 'string' ? `: ${detail.slice(0, 300)}` : '.'}`
}
