// Fails the build when the search index is missing, or a page links to a path
// or heading the built site lacks.
// GitHub Pages serves dist/ at BASE, so every internal URL must start with it.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const BASE = '/familiar/'
const dist = new URL('../dist/', import.meta.url).pathname

const pages = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory()
      ? pages(path)
      : path.endsWith('.html')
        ? [path]
        : []
  })

const ids = new Map<string, Set<string>>()
const idsIn = (file: string) => {
  let found = ids.get(file)
  if (!found) {
    const html = readFileSync(file, 'utf8')
    found = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))
    ids.set(file, found)
  }
  return found
}

const target = (pathname: string) => {
  const path = join(dist, decodeURIComponent(pathname.slice(BASE.length)))
  return pathname.endsWith('/') ? join(path, 'index.html') : path
}

const problems: string[] = []
// Astro still exits 0 when Pagefind fails, leaving the site without search.
if (!existsSync(join(dist, 'pagefind/pagefind.js'))) {
  problems.push('dist has no Pagefind search index')
}
const built = pages(dist)
for (const page of built) {
  const html = readFileSync(page, 'utf8')
  const from = relative(dist, page)
  for (const [, url] of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    if (/^(https?:|mailto:|data:|#$)/.test(url)) {
      continue
    }
    const [pathname, hash] = url.split('#')
    const file = pathname ? target(pathname) : page
    if (pathname && !pathname.startsWith(BASE)) {
      problems.push(`${from}: ${url} is outside ${BASE}`)
    } else if (!existsSync(file)) {
      problems.push(`${from}: ${url} does not exist`)
    } else if (hash && file.endsWith('.html') && !idsIn(file).has(hash)) {
      problems.push(`${from}: ${url} has no #${hash}`)
    }
  }
}

if (problems.length) {
  console.error(problems.join('\n'))
  process.exit(1)
}
console.log(`Checked links in ${built.length} pages.`)
