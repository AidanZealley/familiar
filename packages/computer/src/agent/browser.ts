import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium, type BrowserContext, type Page } from 'playwright'
import { KEEP_TEXT } from '../shorten.ts'

/**
 * The computer's browser: full Chromium in Chrome's newer headless mode
 * (`channel: 'chromium'`), not Playwright's stripped-down headless shell, so
 * sites see a real browser and a visible one can later use the same build
 * and profile. Its profile is kept in `profileDir`, with password saving off:
 * passwords stay on the host. It uses the proxy in `HTTPS_PROXY`, if any,
 * as a provider's computer must. It starts on first use and again after it
 * closes or crashes.
 */
export function openBrowser(profileDir: string) {
  let running: Promise<BrowserContext> | undefined

  const launch = async () => {
    turnOffPasswordSaving(profileDir)
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
 * Chromium reads these from the profile on start. Set every launch, since
 * Chromium rewrites the file as it runs.
 */
function turnOffPasswordSaving(profileDir: string) {
  const path = resolve(profileDir, 'Default', 'Preferences')
  mkdirSync(resolve(profileDir, 'Default'), { recursive: true })
  let preferences: Record<string, unknown> = {}
  try {
    preferences = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    // A new profile, or one Chromium can rebuild.
  }
  preferences.credentials_enable_service = false
  preferences.profile = {
    ...(preferences.profile as object | undefined),
    password_manager_enabled: false,
  }
  writeFileSync(path, JSON.stringify(preferences))
}
