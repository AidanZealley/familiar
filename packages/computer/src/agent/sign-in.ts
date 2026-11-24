import type { Locator, Page } from 'playwright'
import type { z } from 'zod'
import type { signInControls } from '../tools.ts'

type Login = { origin: string; username: string; password: string }

/** What the page scripts read of a control; the package has no DOM types. */
type Control = {
  matches(selector: string): boolean
  readonly ownerDocument: {
    readonly location: { readonly origin: string }
    querySelectorAll(selector: string): ArrayLike<Control>
  }
  readonly form?: {
    readonly action: string
    readonly elements: ArrayLike<Control>
    method: string
    checkValidity(): boolean
  } | null
  readonly formAction?: string
  hasAttribute(name: string): boolean
  removeAttribute(name: string): void
}
type Result = { text: string; isError?: boolean }

const TIMEOUT = 5000

const failed = (text: string): Result => ({ text, isError: true })

/**
 * Fills a saved login into the page and submits it, only where the
 * password stays on its site and out of any URL, as a password manager
 * does. The page, each control's frame and where the form sends it must
 * all be on the login's origin. Its form is made to send by POST, so the
 * browser never puts the password in the address, history and the next
 * snapshot as a GET would, even when the page leaves the sending to it.
 *
 * The site's own script is trusted, as it is by a password manager: it can
 * read what's typed into its page and send it anywhere, so the checks stop
 * the form's declared destination, not a hostile page.
 *
 * Never retried here, since submitting may navigate. Stopping before the
 * click means no click. A form the browser wouldn't send, with a required
 * field empty, isn't submitted. A login that wasn't submitted is cleared from the
 * field. Its results are fixed text, never an error's, which could hold the
 * login.
 */
export async function signIn(
  page: Page,
  login: Login,
  controls: z.infer<typeof signInControls>,
  signal: AbortSignal,
): Promise<Result> {
  const pageOrigin = URL.parse(page.url())?.origin
  if (pageOrigin !== login.origin) {
    return failed(
      `This login is for ${login.origin}, but the browser is on ${pageOrigin ?? 'no site'}. Open the saved site; it must match exactly, including www.`,
    )
  }
  const username = page.locator(`aria-ref=${controls.username}`)
  const password = page.locator(`aria-ref=${controls.password}`)
  const submit =
    'submit' in controls
      ? page.locator(`aria-ref=${controls.submit}`)
      : page.getByRole('button', { name: controls.submitLabel, exact: true })

  const secure = () =>
    secureForm(login.origin, password, username, submit).catch(
      () => 'controls' as const,
    )
  const before = await secure()
  if (before === 'controls') {
    return failed(
      "Couldn't use those controls. Take a fresh browser snapshot and pass the username and password fields and the Log In button.",
    )
  }
  if (before === 'destination') {
    return failed(
      "This form would send the login to another site, so it wasn't filled.",
    )
  }

  let submitted = false
  try {
    try {
      await username.fill(login.username, { timeout: TIMEOUT })
      await password.fill(login.password, { timeout: TIMEOUT })
    } catch {
      return failed(
        "Couldn't fill the login. Take a fresh browser snapshot and try again.",
      )
    }
    try {
      // Waits until it can be clicked, as once a form's own checks pass.
      await submit.click({ trial: true, timeout: TIMEOUT })
    } catch {
      return failed(
        "Filled the login, but the Log In button couldn't be clicked. Check the page for a missing field or a challenge.",
      )
    }
    const after = await secure()
    if (after === 'destination' || after === 'controls') {
      return failed(
        "The form changed after the login was filled, so it wasn't submitted.",
      )
    }
    if (after === 'incomplete') {
      return failed(
        "Filled the login, but the form isn't complete. Check the page for a missing field.",
      )
    }
    signal.throwIfAborted()
    await submit.click({ timeout: 1000 })
    submitted = true
    return { text: 'Submitted the login. Check the browser for the outcome.' }
  } finally {
    if (!submitted) {
      await password.fill('', { timeout: 1000 }).catch(() => {})
    }
  }
}

/**
 * Checks the controls are a username field, a password field and a button
 * all on `origin`, in a form, if any, that sends only to `origin`, by any of
 * its buttons, as a script may submit it with any. Then makes the form send
 * by POST, its buttons' own methods removed, and says whether the browser
 * would send it now: not with a required field empty.
 */
async function secureForm(
  origin: string,
  password: Locator,
  username: Locator,
  submit: Locator,
) {
  const others = [
    await username.elementHandle({ timeout: TIMEOUT }),
    await submit.elementHandle({ timeout: TIMEOUT }),
  ]
  return password.evaluate(
    (element, [user, button, origin]) => {
      const [field, name, send] = [element, user, button] as unknown as (
        Control | undefined
      )[]
      if (
        ![field, name, send].every(
          (control) => control?.ownerDocument.location.origin === origin,
        ) ||
        !field!.matches('input[type=password]') ||
        !name!.matches(
          'input:is(:not([type]),[type=text],[type=email],[type=tel])',
        )
      ) {
        return 'controls'
      }
      const form = field!.form
      if (!form) {
        return 'ready'
      }
      // `elements` leaves out image buttons, which submit it all the same.
      const submitters = [
        ...Array.from(form.elements).filter((control) =>
          control.matches('button:not([type]), [type=submit]'),
        ),
        ...Array.from(
          field!.ownerDocument.querySelectorAll('input[type=image]'),
        ).filter((control) => control.form === form),
      ]
      const actions = [
        form.action,
        ...submitters
          .filter((control) => control.hasAttribute('formaction'))
          .map((control) => control.formAction!),
      ]
      if (actions.some((action) => new URL(action).origin !== origin)) {
        return 'destination'
      }
      form.method = 'post'
      for (const control of [...submitters, send!]) {
        control.removeAttribute('formmethod')
      }
      return form.checkValidity() ? 'ready' : 'incomplete'
    },
    [...others, origin] as const,
    { timeout: TIMEOUT },
  )
}
