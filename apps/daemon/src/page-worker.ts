import { convertHtml } from '@familiar/plugin-web/convert-html'

/** Piscina runs synchronous conversion outside the daemon's event loop. */
export default function readPage({
  html,
  url,
  maxChars,
}: {
  html: string
  url: string
  maxChars: number
}) {
  return convertHtml(html, url, maxChars)
}
