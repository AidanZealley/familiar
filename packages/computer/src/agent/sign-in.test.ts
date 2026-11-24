import { existsSync } from 'node:fs'
import { chromium, type Request } from 'playwright'
import { expect, onTestFinished, test } from 'vitest'
import { snapshotWithoutPasswords } from './browser.ts'
import { signIn } from './sign-in.ts'

const origin = 'https://login.example.test'
const other = 'https://other.example.test'
const login = { origin, username: 'dummy-user', password: 'dummy-password' }

const form = (attributes = 'method="post" action="/session"', button = '') => `
  <form ${attributes}>
    <input aria-label="Username" name="username">
    <input aria-label="Password" name="password" type="password">
    <button ${button}>Sign in</button>
  </form>`

const pages: Record<string, string> = {
  '/': form(),
  '/foreign-action': form(`method="post" action="${other}/session"`),
  '/foreign-button': form(undefined, `formaction="${other}/session"`),
  '/framed': `<iframe src="${other}/"></iframe>`,
  // Native GET submissions, which would put the password in the address.
  '/get': form(''),
  '/get-button': form(undefined, 'formmethod="get"'),
  '/get-shadow': `<div><template shadowrootmode="open">${form('')}</template></div>`,
  '/required': form(undefined, '').replace(
    '</form>',
    '<input aria-label="Code" required></form>',
  ),
  // A form its page sends itself.
  '/script': `${form('')}
    <script>
      document.querySelector('form').addEventListener('submit', (event) => {
        event.preventDefault()
        fetch('/script-session', {
          method: 'POST',
          body: new URLSearchParams(new FormData(event.target)),
        })
      })
    </script>`,
  // Enabled only once the password is typed, as many sites do.
  '/widget': `
    <input aria-label="Account">
    <input aria-label="Secret" type="password">
    <button disabled>Log In</button>
    <script>
      const button = document.querySelector('button')
      document.querySelector('[type=password]').addEventListener('input', () =>
        setTimeout(() => { button.disabled = false }, 50))
      button.addEventListener('click', () => fetch('/widget-session', {
        method: 'POST',
        body: document.querySelector('[type=password]').value,
      }))
    </script>`,
}

test.skipIf(!existsSync(chromium.executablePath()))(
  'fills a saved login only where the password stays on its site',
  async () => {
    const browser = await chromium.launch()
    onTestFinished(() => browser.close())
    const page = await browser.newPage()
    const sent: Request[] = []
    const addresses: string[] = []
    const signal = new AbortController().signal
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      addresses.push(url.href)
      if (route.request().method() === 'POST') {
        sent.push(route.request())
        await route.fulfill({ body: 'ok' })
        return
      }
      await route.fulfill({
        contentType: 'text/html',
        body: pages[url.pathname] ?? form(),
      })
    })
    /** The refs of the labelled controls in a fresh snapshot. */
    const controls = async (user = 'Username', secret = 'Password') => {
      const snapshot = await page.ariaSnapshot({ mode: 'ai' })
      const ref = (label: string) =>
        snapshot
          .split('\n')
          .find((line) => line.includes(`"${label}"`))
          ?.match(/\[ref=([^\]]+)\]/)?.[1] ?? 'missing'
      return {
        username: ref(user),
        password: ref(secret),
        submit: ref('Sign in'),
      }
    }
    const refused = async (path: string, message: RegExp) => {
      await page.goto(`${path.startsWith('http') ? '' : origin}${path}`)
      const result = await signIn(page, login, await controls(), signal)
      expect(result).toEqual({
        text: expect.stringMatching(message),
        isError: true,
      })
      expect(sent).toEqual([])
      expect(page.url()).not.toContain(login.password)
      if (!path.startsWith('http') && path !== '/framed') {
        expect(await page.getByLabel('Password').inputValue()).toBe('')
      }
    }

    await refused(other, /browser is on https:\/\/other\.example\.test/)
    await refused('/foreign-action', /another site/)
    await refused('/foreign-button', /another site/)
    await refused('/framed', /Couldn't use those controls/)
    await refused('/required', /isn't complete/)

    // Sent by POST instead, so the password never reaches an address.
    for (const [path, target] of [
      ['/get', '/get'],
      ['/get-button', '/session'],
      ['/get-shadow', '/get-shadow'],
    ]) {
      await page.goto(`${origin}${path}`)
      expect(await signIn(page, login, await controls(), signal)).toEqual({
        text: expect.stringMatching(/^Submitted/),
      })
      await expect.poll(() => sent.at(-1)?.url()).toBe(`${origin}${target}`)
      expect(sent.at(-1)!.method()).toBe('POST')
    }
    expect(addresses.join(' ')).not.toContain(login.password)

    await page.goto(`${origin}/script`)
    expect(await signIn(page, login, await controls(), signal)).toEqual({
      text: expect.stringMatching(/^Submitted/),
    })
    await expect.poll(() => sent.at(-1)?.url()).toBe(`${origin}/script-session`)

    await page.goto(`${origin}/widget`)
    const widget = await controls('Account', 'Secret')
    expect(
      await signIn(
        page,
        login,
        {
          username: widget.username,
          password: widget.password,
          submitLabel: 'Log In',
        },
        signal,
      ),
    ).toEqual({ text: expect.stringMatching(/^Submitted/) })
    await expect.poll(() => sent.at(-1)?.postData()).toBe(login.password)

    // The model's snapshot never shows a typed password.
    await page.goto(origin)
    await page.getByLabel('Password').fill(login.password)
    expect(await snapshotWithoutPasswords(page)).not.toContain(login.password)

    await page.goto(origin)
    expect(await signIn(page, login, await controls(), signal)).toEqual({
      text: expect.stringMatching(/^Submitted/),
    })
    await expect.poll(() => sent.at(-1)?.url()).toBe(`${origin}/session`)
    expect(
      Object.fromEntries(new URLSearchParams(sent.at(-1)!.postData()!)),
    ).toEqual({ username: login.username, password: login.password })
  },
  30_000,
)
