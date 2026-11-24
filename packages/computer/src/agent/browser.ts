import {
  chromium,
  type BrowserContext,
  type Page,
  type Worker,
} from 'playwright'
import { fileURLToPath } from 'node:url'
import { KEEP_TEXT } from '../shorten.ts'

/** Ours, for Chrome's own record of the shown tab (see `shown`). */
const EXTENSION = fileURLToPath(new URL('../../extension', import.meta.url))

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
      args: [
        '--start-maximized',
        `--disable-extensions-except=${EXTENSION}`,
        `--load-extension=${EXTENSION}`,
      ],
      ignoreDefaultArgs: ['--disable-extensions'],
      ...(proxy && { proxy: { server: proxy } }),
    })
    context.on('close', () => {
      running = undefined
    })
    return context
  }

  /**
   * The page the browser shows: its active tab, which the person may have
   * switched to. And whether the browser has just started, so earlier pages
   * are gone. It starts the browser, or opens a tab, if needed; with `open`
   * false it never does (a person is using the display), and there may be
   * no page.
   */
  async function page(): Promise<{ page: Page; started: boolean }>
  async function page(options: {
    open: boolean
  }): Promise<{ page: Page; started: boolean } | undefined>
  async function page({ open = true } = {}) {
    if (!open) {
      const shownNow = running && (await shown(await running))
      return shownNow ? { page: shownNow, started: false } : undefined
    }
    const started = !running
    running ??= launch().catch((error) => {
      running = undefined
      throw error
    })
    const context = await running
    return {
      page: (await shown(context)) ?? (await context.newPage()),
      started,
    }
  }

  return {
    page,
    /** The page as text, with a ref for each element, up to `KEEP_TEXT`. */
    snapshot: async (page: Page) =>
      `Page: ${await page.title()}\nAddress: ${page.url()}\n\n${await snapshotWithoutPasswords(page)}`.slice(
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

/**
 * The page's AI snapshot, which shows what's typed in each field, with
 * every password field's value masked, in any frame or shadow root, so the
 * model never reads one, such as a saved login `sign_in` filled.
 */
export async function snapshotWithoutPasswords(page: Page) {
  const snapshot = await page.ariaSnapshot({ mode: 'ai' })
  const fields = await Promise.all(
    page.frames().map((frame) =>
      frame
        .locator('input[type=password]')
        .evaluateAll((fields) =>
          fields.map((field) => (field as unknown as { value: string }).value),
        )
        .catch((): string[] => []),
    ),
  )
  const passwords = fields.flat().filter(Boolean)
  return snapshot
    .split('\n')
    .map((line) => {
      const password = passwords.find((value) => line.endsWith(`: ${value}`))
      return password ? `${line.slice(0, -password.length)}••••••••` : line
    })
    .join('\n')
}

/** Settles with `fallback` if `promise` takes longer than 500 ms. */
const within = <T>(promise: Promise<T>, fallback: T) =>
  Promise.race([
    promise,
    new Promise<T>((done) => setTimeout(done, 500, fallback)),
  ])

/**
 * The tab the person sees, of the browser's pages, or none if it has none.
 * Pages can't say, as Playwright has every page act shown and focused, so
 * Chrome is asked, in our extension's service worker: the active tab of its
 * last focused window, as a DevTools target, which names one page.
 */
async function shown(context: BrowserContext) {
  const pages = context.pages()
  if (pages.length < 2) {
    return pages[0]
  }
  const ours = (worker: Worker) =>
    worker.url().startsWith('chrome-extension://')
  const extension =
    context.serviceWorkers().find(ours) ??
    (await context.waitForEvent('serviceworker', { predicate: ours }))
  const [active, targets] = await Promise.all([
    extension.evaluate<string | undefined>(ACTIVE_TARGET),
    Promise.all(
      pages.map(async (page) => {
        const session = await context.newCDPSession(page)
        try {
          return (await session.send('Target.getTargetInfo')).targetInfo
            .targetId
        } finally {
          await session.detach()
        }
      }),
    ),
  ])
  const page = pages[targets.indexOf(active!)]
  if (!page) {
    throw new Error("The browser couldn't say which tab is shown. Try again.")
  }
  return page
}

/** In the extension's worker: the DevTools target of the active tab. */
const ACTIVE_TARGET = `(async () => {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  return (await chrome.debugger.getTargets()).find((target) => target.tabId === tab?.id)?.id
})()`
