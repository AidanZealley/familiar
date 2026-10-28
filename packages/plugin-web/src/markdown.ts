import type { Element, Root, RootContent } from 'hast'
import { fromParse5 } from 'hast-util-from-parse5'
import { toMdast } from 'hast-util-to-mdast'
import type { Nodes as MdastNodes, Parents as MdastParents } from 'mdast'
import { gfmToMarkdown } from 'mdast-util-gfm'
import {
  defaultHandlers,
  toMarkdown,
  type Handle,
} from 'mdast-util-to-markdown'
import { defaultTreeAdapter, parse, type DefaultTreeAdapterMap } from 'parse5'
import { cutPage, type Page } from './shared.ts'

export type { Page } from './shared.ts'

/**
 * How large a page's tree may grow. Conversion is synchronous, so the read's
 * timeout can't interrupt it, and these limits don't bound it either: the
 * host's isolation does (see `Convert`). They refuse the common ways a page
 * gets too big, too many elements or nesting too deep, early and with a
 * message the model can act on.
 */
export const MAX_ELEMENTS = 50_000
export const MAX_DEPTH = 256

const tooComplex = (reason: string) =>
  new Error(`This page is too complex to read: ${reason}.`)
const tooDeep = () => tooComplex(`it nests more than ${MAX_DEPTH} levels deep`)

type Parse5Node = DefaultTreeAdapterMap['node']

/**
 * The page's document, as browsers parse it, or an error past the budget.
 * The budget counts what the parser creates, not the tags in the source:
 * the HTML parser re-creates unclosed formatting elements, so a page of a
 * few thousand tags can make millions of elements, nested thousands deep.
 */
function parseWithinBudget(html: string) {
  let elements = 0
  let open = 0
  const document = parse(html, {
    treeAdapter: {
      ...defaultTreeAdapter,
      createElement: (...args) => {
        if (++elements > MAX_ELEMENTS) {
          throw tooComplex(
            `it has more than ${MAX_ELEMENTS.toLocaleString('en')} elements`,
          )
        }
        return defaultTreeAdapter.createElement(...args)
      },
      // The parser's stack of open elements, whose scopes it searches for
      // most tags, so its work grows with the stack's depth.
      onItemPush: () => {
        if (++open > MAX_DEPTH) {
          throw tooDeep()
        }
      },
      onItemPop: () => {
        open--
      },
    },
  })

  // Every later step recurses through the tree, which can end up a little
  // deeper than the stack ever was: misnested tags move finished subtrees
  // under new elements. So the tree is measured too, without recursing.
  const pending: [Parse5Node, number][] = [[document, 0]]
  for (let next = pending.pop(); next; next = pending.pop()) {
    const [node, depth] = next
    if (depth > MAX_DEPTH) {
      throw tooDeep()
    }
    for (const child of 'childNodes' in node ? node.childNodes : []) {
      pending.push([child, depth + 1])
    }
    if ('content' in node) {
      pending.push([node.content, depth + 1])
    }
  }
  return document
}

/** Elements that aren't the page's content, or can't be read as text. */
const DROPPED = new Set([
  'nav',
  'header',
  'footer',
  'aside',
  'script',
  'style',
  'noscript',
  'form',
  'iframe',
  'svg',
  'template',
  'base',
])

const isElement = (node: RootContent | Root): node is Element =>
  node.type === 'element'

/** The first element named `name`, in document order. */
function find(node: Root | Element, name: string): Element | undefined {
  for (const child of node.children) {
    if (isElement(child)) {
      const found = child.tagName === name ? child : find(child, name)
      if (found) {
        return found
      }
    }
  }
  return undefined
}

function text(node: RootContent | Root): string {
  if (node.type === 'text') {
    return node.value
  }
  return 'children' in node ? node.children.map(text).join('') : ''
}

/** `node` without comments and the elements in DROPPED, changed in place. */
function prune<T extends Root | Element>(node: T): T {
  node.children = node.children.filter(
    (child) =>
      child.type !== 'comment' &&
      !(isElement(child) && DROPPED.has(child.tagName)),
  ) as T['children']
  for (const child of node.children) {
    if (isElement(child)) {
      prune(child)
    }
  }
  return node
}

/** `url` made absolute, if it's a web address a model can fetch. */
function webUrl(url: string, base: string) {
  const absolute = url.trim() ? URL.parse(url, base) : null
  return absolute?.protocol === 'http:' || absolute?.protocol === 'https:'
    ? absolute.href
    : undefined
}

/**
 * Links and images resolved against `base`, keeping only `http:` and `https:`
 * ones: a link elsewhere (`javascript:`, `data:`, a mail address) keeps its
 * text, and an image elsewhere goes.
 */
function keepWebUrls(node: MdastParents, base: string) {
  node.children = node.children.flatMap((child: MdastNodes) => {
    if (child.type === 'link' || child.type === 'image') {
      const url = webUrl(child.url, base)
      if (url) {
        child.url = url
      } else {
        return child.type === 'link' ? child.children : []
      }
    }
    return [child]
  }) as typeof node.children
  for (const child of node.children) {
    if ('children' in child) {
      keepWebUrls(child, base)
    }
  }
}

/**
 * Turns an HTML page into Markdown, as `htmlToMarkdown` does, wherever the
 * host runs it. Conversion is synchronous and its cost depends on the page,
 * so a host bounds it: a Cloudflare Worker's CPU limit already does, and the
 * daemon runs it in a worker thread it can stop. It rejects with an error
 * the model reads when the page can't be converted.
 */
export type Convert = (
  html: string,
  url: string,
  options: ConvertOptions,
) => Promise<Page>

export type ConvertOptions = {
  /** The most Markdown to return; `total` says how much the page made. */
  maxChars: number
}

/**
 * A link or image with its URL as written. Markdown escapes `&` before a
 * letter, as `\&`, so a renderer won't read `&amp;` as `&`; nothing renders
 * this Markdown, and a model copying the URL would copy the backslash too.
 */
const literalUrl =
  (handle: Handle): Handle =>
  (...args) =>
    handle(...args).replaceAll('\\&', '&')

/**
 * An HTML page as Markdown: its main content, the first `<article>`, else
 * `<main>`, else the body, without navigation, scripts and other chrome.
 * Throws when the page is past the complexity budget.
 */
export function htmlToMarkdown(
  html: string,
  url: string,
  { maxChars }: ConvertOptions,
): Page {
  // A document always converts to a root.
  const document = fromParse5(parseWithinBudget(html)) as Root
  const heading = find(document, 'title') ?? find(document, 'h1')
  const title = heading ? text(heading).replace(/\s+/g, ' ').trim() : ''

  // A <base> moves relative links, but only to another web address.
  const declaredBase = find(document, 'base')?.properties.href
  const base =
    (typeof declaredBase === 'string' && webUrl(declaredBase, url)) || url

  const main =
    find(document, 'article') ??
    find(document, 'main') ??
    find(document, 'body') ??
    document
  const content: Root =
    main.type === 'root' ? main : { type: 'root', children: [main] }
  const tree = toMdast(prune(content), { document: true })
  if ('children' in tree) {
    keepWebUrls(tree, base)
  }
  // Resolving links can make the Markdown far longer than the page: a long
  // <base> is repeated in every link.
  const markdown = toMarkdown(tree, {
    bullet: '-',
    fences: true,
    handlers: {
      link: literalUrl(defaultHandlers.link),
      image: literalUrl(defaultHandlers.image),
    },
    extensions: [gfmToMarkdown({ tablePipeAlign: false })],
  }).trim()
  return cutPage(markdown, maxChars, title)
}
