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
 * or any window's, or failing those, the newest page. Of tabs with titles
 * that fit, the longest title, then the newest.
 */
async function focused(pages: Page[]) {
  const titles = await Promise.all(
    pages.map((page) => within(page.title(), '')),
  )
  for (const name of await screen.windowNames('chromium')) {
    let best = -1
    titles.forEach((title, index) => {
      if (
        title &&
        name.startsWith(`${title} - `) &&
        title.length >= (titles[best]?.length ?? 0)
      ) {
        best = index
      }
    })
    if (best >= 0) {
      return pages[best]
    }
  }
  return pages.at(-1)
}
