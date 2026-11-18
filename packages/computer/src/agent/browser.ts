import { chromium, type BrowserContext, type Page } from 'playwright'
import { KEEP_TEXT } from '../shorten.ts'

/**
 * The computer's browser: full Chromium in Chrome's newer headless mode
 * (`channel: 'chromium'`), not Playwright's stripped-down headless shell, so
 * sites see a real browser and a visible one can later use the same build
 * and profile. Its profile is kept in `profileDir`. It uses the proxy in
 * `HTTPS_PROXY`, if any, as a Docker computer must. It starts on first use
 * and again after it closes or crashes.
 */
export function openBrowser(profileDir: string) {
  let running: Promise<BrowserContext> | undefined

  const launch = async () => {
    const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy
    const context = await chromium.launchPersistentContext(profileDir, {
      channel: 'chromium',
      headless: true,
      ...(proxy && { proxy: { server: proxy } }),
    })
    context.on('close', () => {
      running = undefined
    })
    return context
  }

  /**
   * The page the browser shows, the newest one if a link opened another,
   * and whether the browser has just started, so earlier pages are gone.
   */
  const page = async (): Promise<{ page: Page; started: boolean }> => {
    const started = !running
    running ??= launch().catch((error) => {
      running = undefined
      throw error
    })
    const context = await running
    return {
      page: context.pages().at(-1) ?? (await context.newPage()),
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
          title: await Promise.race([
            page.title(),
            new Promise<string>((done) => setTimeout(done, 500, '')),
          ]),
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
