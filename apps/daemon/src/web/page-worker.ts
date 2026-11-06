import { htmlToMarkdown } from '@mdream/js'
import { clean } from '@mdream/js/clean'
import { filterPlugin } from '@mdream/js/plugins'

/**
 * HTML as Markdown, without the page's navigation and chrome. Piscina runs
 * it outside the daemon's event loop, since mdream converts synchronously.
 */
export default function pageToMarkdown({
  html,
  url,
}: {
  html: string
  url: string
}) {
  return htmlToMarkdown(html, {
    origin: url,
    clean: clean({ emptyLinks: true }),
    plugins: [
      filterPlugin({ exclude: ['nav', 'header', 'footer', 'aside', 'form'] }),
    ],
  })
}
