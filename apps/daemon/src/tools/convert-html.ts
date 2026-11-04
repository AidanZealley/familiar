import { htmlToMarkdown } from '@mdream/js'
import { clean } from '@mdream/js/clean'
import { filterPlugin } from '@mdream/js/plugins'

export type Page = { text: string; truncated: boolean }
export type ConvertHtml = (
  html: string,
  url: string,
  maxChars: number,
  signal: AbortSignal,
) => Promise<Page>

/** Let mdream own extraction and Markdown syntax; only bound what we return. */
export function convertHtml(html: string, url: string, maxChars: number): Page {
  const text = htmlToMarkdown(html, {
    origin: url,
    clean: clean({ emptyLinks: true }),
    plugins: [
      filterPlugin({ exclude: ['nav', 'header', 'footer', 'aside', 'form'] }),
    ],
  }).trim()
  return { text: text.slice(0, maxChars), truncated: text.length > maxChars }
}
