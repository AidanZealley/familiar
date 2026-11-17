import type { BrowserContext, Locator, Page } from 'playwright'

export type SignInLogin = { origin: string; username: string; password: string }

/**
 * What happened: the login was submitted and the sign-in form went away
 * (`signed in`) or stayed (`submitted`); it may or may not have been
 * (`unknown`); or nothing was filled, because the form is on another
 * origin (`refused`) or there's none (`no form`).
 */
export type SignInOutcome =
  'signed in' | 'submitted' | 'unknown' | 'no form' | { refused: string }

// What `fill` uses of the page's own globals, which Node's types don't describe.
type Field = {
  type: string
  form: (Container & { requestSubmit(): void }) | null
  ownerDocument: unknown
  parentElement: Container | null
  checkVisibility(): boolean
  dispatchEvent(event: Event): boolean
}
type Container = {
  parentElement: Container | null
  querySelector(selector: 'button'): { click(): void } | null
  querySelectorAll(selector: 'input'): Iterable<Field>
}
declare const window: { origin: string; __familiarOrigin?: string }
declare const document: Container
declare const HTMLInputElement: { prototype: object }

const PASSWORD = 'input[type=password]:visible'
const USERNAME = [
  'input[autocomplete~=username]',
  'input[type=email]',
  'input[name*=user i]',
  'input[name*=email i]',
  'input[id*=user i]',
  'input[id*=email i]',
]
  .map((selector) => `${selector}:visible`)
  .join(', ')
const SETTLE_MS = 10_000

/**
 * Records each document's real origin as `window.__familiarOrigin`, which
 * `fill` checks, before any of the document's own scripts run, in a property
 * they can't redefine. Neither `location.origin`, which is the address's
 * origin and so also a sandboxed frame's, nor `window.origin`, which a
 * page's script can redefine, says it reliably. A sandboxed frame's origin
 * is `"null"`.
 */
export const recordOrigins = (context: BrowserContext) =>
  context.addInitScript(() =>
    Object.defineProperty(window, '__familiarOrigin', { value: window.origin }),
  )

/**
 * Signs in on `page` with `login`, once, never retrying. Each step runs as
 * one synchronous script in the field's own frame (`fill`): it checks that
 * frame's real origin (see `recordOrigins`), then fills and submits, so the page can't change
 * between the check and the fill. A form that asks for the username first
 * gets it, then the password once that field appears.
 */
export async function signIn(
  page: Page,
  login: SignInLogin,
): Promise<SignInOutcome> {
  let field: Locator | undefined = await fieldOn(page, PASSWORD, login.origin)
  if (!field) {
    const user = await fieldOn(page, USERNAME, login.origin)
    if (!user) {
      return 'no form'
    }
    const filled = await fillIn(user, login)
    if (filled !== 'submitted') {
      return filled
    }
    field = await until(() => fieldOn(page, PASSWORD, login.origin))
    if (!field) {
      return 'submitted'
    }
  }
  const filled = await fillIn(field, login)
  if (filled !== 'submitted') {
    return filled
  }
  const gone = await until(async () => !(await fieldOn(page, PASSWORD)))
  return gone ? 'signed in' : 'submitted'
}

/** Runs `fill` on `field`; `unknown` if it may have run but didn't say. */
const fillIn = (field: Locator, login: SignInLogin) =>
  field
    .evaluate(fill, login, { timeout: 5_000 })
    .catch((): SignInOutcome => 'unknown')

/**
 * The first visible field matching `selector` in any of `page`'s frames,
 * preferring one whose frame is at `origin`. Where it really is, `fill`
 * checks.
 */
async function fieldOn(page: Page, selector: string, origin?: string) {
  const found: Locator[] = []
  for (const frame of page.frames()) {
    const field = frame.locator(selector).first()
    if (await field.count().catch(() => 0)) {
      if (origin && URL.parse(frame.url())?.origin === origin) {
        return field
      }
      found.push(field)
    }
  }
  return found[0]
}

/** Polls `check` until it gives something truthy, or `SETTLE_MS` passes. */
async function until<T>(check: () => Promise<T>) {
  const end = Date.now() + SETTLE_MS
  for (;;) {
    const result = await check().catch(() => undefined)
    if (result || Date.now() > end) {
      return result
    }
    await new Promise((done) => setTimeout(done, 250))
  }
}

/**
 * Runs in the page, in the field's own frame, in one go. Fills `field`
 * (a password field with the password and the username field before it,
 * else a username field) and submits its form, only if the frame's real
 * origin is the login's.
 */
function fill(
  field: Field,
  { origin, username, password }: SignInLogin,
): SignInOutcome {
  const real = window.__familiarOrigin
  if (real !== origin || field.ownerDocument !== document) {
    return {
      refused:
        real && real !== 'null'
          ? real
          : 'a page with no origin of its own, such as a sandboxed frame',
    }
  }
  const set = (input: Field, value: string) => {
    // The native setter, so frameworks that track the value see the change.
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }
  if (field.type === 'password') {
    const inputs = [...(field.form ?? document).querySelectorAll('input')]
    const user = inputs
      .slice(0, inputs.indexOf(field))
      .reverse()
      .find(
        (input) =>
          /^(text|email|tel)$/.test(input.type) && input.checkVisibility(),
      )
    if (user) {
      set(user, username)
    }
    set(field, password)
  } else {
    set(field, username)
  }
  if (field.form) {
    field.form.requestSubmit()
  } else {
    // No form: the nearest button around the field.
    for (
      let around = field.parentElement;
      around;
      around = around.parentElement
    ) {
      const button = around.querySelector('button')
      if (button) {
        button.click()
        break
      }
    }
  }
  return 'submitted'
}
