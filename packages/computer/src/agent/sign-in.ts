import type { Page } from 'playwright'

export type SignInLogin = { origin: string; username: string; password: string }

/**
 * What happened: the login was submitted and the sign-in form went away
 * (`signed in`) or stayed (`submitted`); it may or may not have been
 * (`unknown`); or nothing was filled, because the form is on another
 * origin (`refused`) or there's none (`no form`).
 */
export type SignInOutcome =
  'signed in' | 'submitted' | 'unknown' | 'no form' | { refused: string }

type Want = 'password' | 'username'

/** Runs `expression` in one frame's isolated world, giving its value. */
type World = (expression: string) => Promise<unknown>

const SETTLE_MS = 10_000

/**
 * Signs in on `page` with `login`, once, never retrying. Each step runs as
 * one synchronous script (`inFrame`) in an isolated world of the field's
 * frame, which the page's own scripts can't reach or alter: it reads the
 * frame's real origin, then fills and submits only if it's the login's, so
 * the page can't forge the check or change between it and the fill. A form
 * that asks for the username first gets it, then the password once that
 * field appears.
 */
export async function signIn(
  page: Page,
  login: SignInLogin,
): Promise<SignInOutcome> {
  let filled = await fillIn(page, 'password', login)
  if (filled === 'no form') {
    filled = await fillIn(page, 'username', login)
    if (filled !== 'submitted') {
      return filled
    }
    const next = await until(async () => {
      const outcome = await fillIn(page, 'password', login)
      return outcome === 'no form' ? undefined : outcome
    })
    if (!next) {
      return 'submitted'
    }
    filled = next
  }
  if (filled !== 'submitted') {
    return filled
  }
  const gone = await until(async () => !(await passwordShowing(page)))
  return gone ? 'signed in' : 'submitted'
}

/**
 * Fills the `want` field in a frame at the login's origin. Each frame is
 * first asked only its origin, so the password goes to no other.
 */
const fillIn = (page: Page, want: Want, login: SignInLogin) =>
  inWorlds(page, async (worlds): Promise<SignInOutcome> => {
    const found = await withField(worlds, want)
    const at = found.find(({ origin }) => origin === login.origin) ?? found[0]
    if (!at) {
      return 'no form'
    }
    if (at.origin !== login.origin) {
      return refused(at.origin)
    }
    const outcome = await at
      .world(call(inFrame, want, login))
      .catch(() => 'unknown')
    return outcome as SignInOutcome
  })

const passwordShowing = (page: Page) =>
  inWorlds(
    page,
    async (worlds) => (await withField(worlds, 'password')).length > 0,
  )

/** Each world with a visible `want` field, and its frame's real origin. */
async function withField(worlds: World[], want: Want) {
  const found: { world: World; origin: string }[] = []
  for (const world of worlds) {
    const origin = await world(call(inFrame, want)).catch(() => undefined)
    if (typeof origin === 'string') {
      found.push({ world, origin })
    }
  }
  return found
}

const refused = (origin: string) => ({
  refused:
    origin === 'null'
      ? 'a page with no origin of its own, such as a sandboxed frame'
      : origin,
})

/**
 * Gives `use` a fresh isolated world in each of `page`'s frames, through
 * the DevTools protocol. Frames in another process (other sites, sandboxed
 * frames) have a session of their own; the rest are in their parent's.
 */
async function inWorlds<T>(page: Page, use: (worlds: World[]) => Promise<T>) {
  const sessions = (
    await Promise.all(
      page.frames().map((frame) =>
        page
          .context()
          .newCDPSession(frame === page.mainFrame() ? page : frame)
          .catch(() => undefined),
      ),
    )
  ).filter((session) => session !== undefined)
  try {
    const worlds: World[] = []
    for (const session of sessions) {
      const { frameTree } = await session.send('Page.getFrameTree')
      type Tree = typeof frameTree
      const ids = (tree: Tree): string[] => [
        tree.frame.id,
        ...(tree.childFrames ?? []).flatMap(ids),
      ]
      for (const frameId of ids(frameTree)) {
        const world = await session
          .send('Page.createIsolatedWorld', {
            frameId,
            worldName: 'familiar-sign-in',
          })
          .catch(() => undefined)
        if (world) {
          worlds.push(async (expression) => {
            const { result, exceptionDetails } = await session.send(
              'Runtime.evaluate',
              {
                contextId: world.executionContextId,
                expression,
                returnByValue: true,
                timeout: 5_000,
              },
            )
            if (exceptionDetails) {
              throw new Error('The sign-in script failed.')
            }
            return result.value
          })
        }
      }
    }
    return await use(worlds)
  } finally {
    await Promise.all(
      sessions.map((session) => session.detach().catch(() => {})),
    )
  }
}

/** `fn` called with `args`, as an expression; JSON keeps them data. */
const call = (fn: (...args: never[]) => unknown, ...args: unknown[]) =>
  `(${fn})(...${JSON.stringify(args)})`

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

// What `inFrame` uses of the frame's globals, which Node's types don't describe.
type Field = {
  type: string
  value: string
  form: (Container & { requestSubmit(): void }) | null
  parentElement: Container | null
  checkVisibility(): boolean
  dispatchEvent(event: Event): boolean
}
type Container = {
  parentElement: Container | null
  querySelector(selector: 'button'): { click(): void } | null
  querySelectorAll(selector: string): Iterable<Field>
}
declare const self: { origin: string }
declare const document: Container

/**
 * Runs in an isolated world of one frame, in one go, using only that
 * world's own untouched globals. Finds the first visible `want` field.
 * Without `login`, gives the frame's real origin (`self.origin`, `"null"`
 * for a sandboxed frame), or null if there's no such field. With it, fills
 * the field (a password field with the password and the username field
 * before it, else a username field) and submits its form, only if that
 * origin is the login's.
 */
function inFrame(
  want: Want,
  login?: SignInLogin,
): string | null | SignInOutcome {
  const visible = (selector: string) =>
    [...document.querySelectorAll(selector)].filter((input) =>
      input.checkVisibility(),
    )
  const [field] = visible(
    want === 'password'
      ? 'input[type=password]'
      : 'input[autocomplete~=username], input[type=email], input[name*=user i], input[name*=email i], input[id*=user i], input[id*=email i]',
  )
  if (!field) {
    return login ? 'no form' : null
  }
  if (!login) {
    return self.origin
  }
  if (self.origin !== login.origin) {
    return { refused: self.origin }
  }
  // Set in this world, so a framework's value tracking in the page's sees
  // the change, as it would a person's typing.
  const set = (input: Field, value: string) => {
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }
  if (want === 'password') {
    const inputs = [...(field.form ?? document).querySelectorAll('input')]
    const user = inputs
      .slice(0, inputs.indexOf(field))
      .reverse()
      .find(
        (input) =>
          /^(text|email|tel)$/.test(input.type) && input.checkVisibility(),
      )
    if (user) {
      set(user, login.username)
    }
    set(field, login.password)
  } else {
    set(field, login.username)
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
