import { chromium, type BrowserContext, type Page } from 'playwright'
import { KEEP_TEXT } from '../shorten.ts'
import { screen } from './screen.ts'

/**
 * The computer's browser: full Chromium (`channel: 'chromium'`), visible on
 * the display in a maximised window sized by the window manager, so a person
 * watching sees it and the screen tools can use it. Its profile is kept in
 * `profileDir`. It uses the proxy in `HTTPS_PROXY`, if any, as a Docker
 * computer must. It starts on first use and again after it closes or
 * crashes.
 */
export function openBrowser(profileDir: string) {
  let running: Promise<BrowserContext> | undefined

  const launch = async () => {
    const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy
    const context = await chromium.launchPersistentContext(profileDir, {
      channel: 'chromium',
      headless: false,
      // Pages are the window's size, not one Playwright picks.
      viewport: null,
      args: ['--start-maximized'],
      ...(proxy && { proxy: { server: proxy } }),
    })
    context.on('close', () => {
      running = undefined
    })
    return context
  }

  /**
   * The page the browser shows: its focused tab, which the person may have
   * switched to, or the newest if it can't tell. And whether the browser has
   * just started, so earlier pages are gone.
   */
  const page = async (): Promise<{ page: Page; started: boolean }> => {
    const started = !running
    running ??= launch().catch((error) => {
      running = undefined
      throw error
    })
    const context = await running
    return {
      page: (await focused(context.pages())) ?? (await context.newPage()),
      started,
    }
  }

  return {
    page,
    /** The page as text, with a ref for each element, up to `KEEP_TEXT`. */
    snapshot: async (page: Page) =>
      `Page: ${await page.title()}\nAddress: ${page.url()}\n\n${await page.ariaSnapshot({ mode: 'ai' })}`.slice(
        0,
        KEEP_TEXT,
      ),
    /** Its open pages, without starting it: none while it isn't running. */
    tabs: async () => {
      const context = await running?.catch(() => undefined)
      return Promise.all(
        (context?.pages() ?? []).map(async (page) => ({
          // A page mid-navigation can't say until it lands.
          title: await within(page.title(), ''),
          url: page.url(),
        })),
      )
    },
    /** An element by the ref a snapshot gave it. */
    element: (page: Page, ref: string) => page.locator(`aria-ref=${ref}`),
    close: async () => {
      const context = await running?.catch(() => undefined)
      await context?.close()
    },
  }
}

export type Browser = ReturnType<typeof openBrowser>

/** Settles with `fallback` if `promise` takes longer than 500 ms. */
const within = <T>(promise: Promise<T>, fallback: T) =>
  Promise.race([
    promise,
    new Promise<T>((done) => setTimeout(done, 500, fallback)),
  ])

/**
 * The tab the person sees. Pages can't tell, as Playwright has every page
 * act shown and focused, so it's read from the display: a browser window's
 * name starts with its shown tab's title. The focused window's shown tab,
 * or any window's, or failing those, the newest page. Of tabs whose titles
 * fit, the longest title; of tabs with that same title, `shownOf` says.
 */
async function focused(pages: Page[]) {
  const titles = await Promise.all(
    pages.map((page) => within(page.title(), '')),
  )
  for (const name of await screen.windowNames('chromium')) {
    const fit = titles.filter(
      (title) => title && name.startsWith(`${title} - `),
    )
    const longest = Math.max(0, ...fit.map((title) => title.length))
    const shown = pages.filter(
      (_, index) =>
        fit.includes(titles[index]!) && titles[index]!.length === longest,
    )
    if (shown.length) {
      return shown.length === 1
        ? shown[0]
        : ((await shownOf(shown)) ?? shown.at(-1))
    }
  }
  return pages.at(-1)
}

/** Invisible, so marking a title shows nothing to a person. */
const MARK = '\u2063'

/**
 * Which of `pages`, which share a title, is shown: each title is marked for
 * a moment with its own count of `MARK`s, and the window's name then shows
 * the shown one's. Each title is put back unless the page has changed it
 * meanwhile. Undefined if no window shows a mark within half a second.
 */
async function shownOf(pages: Page[]) {
  const marks = pages.map((_, index) => MARK.repeat(index + 1))
  const run = (page: Page, script: string) =>
    within(
      page.evaluate(script).catch(() => {}),
      undefined,
    )
  await Promise.all(
    pages.map((page, index) =>
      run(page, `document.title += ${JSON.stringify(marks[index])}`),
    ),
  )
  try {
    for (let tries = 0; tries < 10; tries++) {
      for (const name of await screen.windowNames('chromium')) {
        const count = name.match(new RegExp(`(${MARK}+) - `))?.[1]?.length
        if (count && count <= pages.length) {
          return pages[count - 1]
        }
      }
      await new Promise((done) => setTimeout(done, 50))
    }
    return undefined
  } finally {
    await Promise.all(
      pages.map((page, index) => {
        const marked = JSON.stringify(marks[index])
        return run(
          page,
          `if (document.title.endsWith(${marked})) document.title = document.title.slice(0, -${marks[index]!.length})`,
        )
      }),
    )
  }
}
