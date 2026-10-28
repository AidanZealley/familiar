import { Readability } from '@mozilla/readability'
// LinkeDOM's worker build, which inlines its dependencies: a bundler for a
// Worker would otherwise pick CSSOM's browser script, which LinkeDOM can't
// import from.
import { parseHTML } from 'linkedom/worker'
import TurndownService from 'turndown'

type ReadabilityDocument = ConstructorParameters<typeof Readability>[0]
type TurndownInput = Parameters<TurndownService['turndown']>[0]

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
})
turndown.remove(['script', 'style', 'noscript', 'template', 'iframe'])

// Tables as GFM, with the first row as the header a Markdown table needs.
// Written here because turndown-plugin-gfm reads `table.rows`, which
// LinkeDOM doesn't have.
const isCell = (node: { nodeName: string }) =>
  node.nodeName === 'TH' || node.nodeName === 'TD'
turndown.addRule('tableCell', {
  filter: ['th', 'td'],
  replacement: (content) =>
    ` ${content.replace(/\s*\n+\s*/g, ' ').replace(/\|/g, '\\|')} |`,
})
turndown.addRule('tableRow', {
  filter: 'tr',
  replacement: (content, node) => {
    const row = `|${content}\n`
    const table = node.closest('table')
    if (table?.querySelector('tr') !== node) {
      return row
    }
    const cells = [...node.childNodes].filter(isCell).length
    return `${row}|${' --- |'.repeat(cells)}\n`
  },
})
turndown.addRule('tableSection', {
  filter: ['thead', 'tbody', 'tfoot'],
  replacement: (content) => content,
})
turndown.addRule('table', {
  filter: 'table',
  replacement: (content) => `\n\n${content.trim()}\n\n`,
})

// HTML lets a page leave out its <html>, <head> and <body> tags, but LinkeDOM
// doesn't add them as browsers do: without them, it loses the page. So a page
// missing any goes into a full document, its head's elements moved to the head.
const SKELETON = /<\/?(!doctype|html|head|body)\b[^>]*>/gi
const HEAD = 'title, base, meta, link, style'

function parse(html: string) {
  if (/<html[\s>]/i.test(html) && /<body[\s>]/i.test(html)) {
    return parseHTML(html).document
  }
  const { document } = parseHTML(
    '<!doctype html><html><head></head><body></body></html>',
  )
  document.body.innerHTML = html.replace(SKELETON, '')
  for (const element of document.body.querySelectorAll(HEAD)) {
    document.head.append(element)
  }
  return document
}

// A page's DOM, with links and images pointing at absolute URLs so the model
// can fetch what a page links to.
function load(html: string, url: string) {
  const document = parse(html)
  const base = document.querySelector('base[href]')?.getAttribute('href')
  const baseUrl = URL.parse(base ?? '', url)?.href ?? url
  for (const [selector, attribute] of [
    ['a[href]', 'href'],
    ['img[src]', 'src'],
  ]) {
    for (const element of document.querySelectorAll(selector)) {
      const absolute = URL.parse(element.getAttribute(attribute)!, baseUrl)
      if (absolute) {
        element.setAttribute(attribute, absolute.href)
      }
    }
  }
  return document
}

/**
 * An HTML page as Markdown: its main content, as Readability finds it, or
 * the whole body when it finds none.
 */
export function htmlToMarkdown(html: string, url: string) {
  const document = load(html, url)
  const pageTitle = document.title?.trim()
  // Readability and Turndown take the DOM's types; LinkeDOM's are shaped the
  // same. Named through their signatures, as hosts may not have the DOM lib.
  const article = new Readability(document as unknown as ReadabilityDocument, {
    serializer: (node) => node,
    keepClasses: true, // `language-*` names a code block's language
  }).parse()
  // Readability strips the document as it works, so the fallback parses again.
  const content = article?.content ?? load(html, url).body
  return {
    title: article?.title?.trim() || pageTitle || undefined,
    markdown: content ? turndown.turndown(content as TurndownInput).trim() : '',
  }
}
