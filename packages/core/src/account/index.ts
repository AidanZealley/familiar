import type {
  AssistantMessage,
  LoginOptions,
  Models,
} from '@earendil-works/pi-ai'
import {
  defineExtension,
  GenerationTask,
  hook,
  type Extension,
} from '@earendil-works/pi-durable'

/**
 * Whether Familiar can reach its models' provider, as one value. `expired`
 * is a stored login the provider no longer accepts; `error` says why the
 * last sign-in failed.
 */
export type AccountState =
  | { status: 'signed-in' }
  | { status: 'signed-out' | 'expired'; error?: string }
  | {
      status: 'signing-in'
      /** The provider's page to sign in on, once it has one. */
      url?: string
      /** A code to enter on that page, for providers that issue one. */
      code?: string
      /**
       * The provider is waiting for the address the browser ended on. The
       * page returns to this machine, so from any other device it won't load
       * and the owner pastes its address instead.
       */
      paste?: boolean
    }

export type AccountApi = {
  state(): AccountState
  /** Calls `listener` with each new state. Returns a function that stops it. */
  onChange(listener: (state: AccountState) => void): () => void
  /**
   * Starts signing in, unless it already is. The page to open, and any code
   * to enter there, arrive in the state.
   */
  signIn(): void
  /** The address the browser ended on, when the state asks to `paste` it. */
  answer(text: string): void
  cancelSignIn(): void
  signOut(): Promise<void>
}

export type AccountOptions = {
  /** The same `Models` the host passes to `summonFamiliar`. */
  models: Pick<Models, 'checkAuth' | 'getAuth' | 'login' | 'logout'>
  /** The provider whose login this is: the one Familiar's `model` comes from. */
  provider: string
  /**
   * What the host tells the provider about itself when signing in. ChatGPT
   * needs `getDeviceId`: OpenAI identifies the app's logins by it.
   */
  login?: LoginOptions
}

/**
 * Interactive sign-in and sign-out for one provider's login. Use it on its
 * own, or pass it to `summonFamiliar` as `account`: that Familiar then owns
 * it, offers `api` to owners and closes it on dismiss.
 */
export type Account = {
  api: AccountApi
  /**
   * Stops any unfinished sign-in and every listener. The stored login stays;
   * signing out is `api.signOut()`. Later calls do nothing.
   */
  close(): void
}

/**
 * What only Familiar sees of an account: which login it is, and what it
 * does with each response. Kept here so hosts never handle a Pi hook.
 */
const attachments = new WeakMap<
  Account,
  {
    models: AccountOptions['models']
    provider: string
    lifetime: { state: 'available' | 'attached' | 'closed' }
    noteResponse(message: AssistantMessage): Promise<void>
  }
>()

/** pi-ai's id for the login method that works from any device. */
const DEVICE_CODE = 'device_code'

/**
 * The owner's login with the models' provider. It signs in through the same
 * `Models` every request uses, so a new login applies without a restart.
 * Attached to a Familiar, it also notices when a request fails because the
 * login stopped working.
 */
export async function createAccount({
  models,
  provider,
  login,
}: AccountOptions): Promise<Account> {
  const listeners = new Set<(state: AccountState) => void>()
  let state: AccountState
  let signingIn: AbortController | undefined
  let answer: ((text: string) => void) | undefined
  const lifetime: { state: 'available' | 'attached' | 'closed' } = {
    state: 'available',
  }

  // After close, a login or check still finishing changes nothing.
  const set = (next: AccountState) => {
    if (lifetime.state === 'closed') {
      return
    }
    state = next
    listeners.forEach((listener) => listener(next))
  }

  // Whether a login is stored, without touching the network.
  const stored = async (): Promise<
    { status: 'signed-in' } | { status: 'signed-out' }
  > =>
    (await models.checkAuth(provider))
      ? { status: 'signed-in' }
      : { status: 'signed-out' }

  // Whether the login still works: refreshes the token if it's due.
  const working = async (): Promise<AccountState> => {
    try {
      return (await models.getAuth(provider))
        ? { status: 'signed-in' }
        : { status: 'signed-out' }
    } catch {
      return { status: 'expired' }
    }
  }

  state = await stored()

  const api: AccountApi = {
    state: () => state,
    onChange: (listener) => {
      if (lifetime.state === 'closed') {
        return () => {}
      }
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    signIn: () => {
      if (signingIn || lifetime.state === 'closed') {
        return
      }
      const controller = new AbortController()
      signingIn = controller
      set({ status: 'signing-in' })

      // Changes the sign-in's state while it's still the one running.
      const update = (
        change: Omit<Extract<AccountState, { status: 'signing-in' }>, 'status'>,
      ) => {
        if (signingIn === controller && state.status === 'signing-in') {
          set({ ...state, ...change })
        }
      }

      // Waits for `answer`, until the flow stops asking: it was cancelled,
      // or the browser returned to this machine by itself.
      const pasted = (signal?: AbortSignal) =>
        new Promise<string>((resolve, reject) => {
          const stopped = AbortSignal.any(
            signal ? [controller.signal, signal] : [controller.signal],
          )
          const finish = () => {
            answer = undefined
            update({ paste: false })
          }
          const stop = () => {
            finish()
            reject(new Error('Sign-in stopped waiting.'))
          }
          if (stopped.aborted) {
            stop()
            return
          }
          stopped.addEventListener('abort', stop, { once: true })
          answer = (text) => {
            stopped.removeEventListener('abort', stop)
            finish()
            resolve(text)
          }
          update({ paste: true })
        })

      models
        .login(
          provider,
          'oauth',
          {
            signal: controller.signal,
            prompt: async (prompt) => {
              if (prompt.type === 'manual_code' || prompt.type === 'text') {
                return pasted(prompt.signal)
              }
              if (
                prompt.type === 'select' &&
                prompt.options.some((option) => option.id === DEVICE_CODE)
              ) {
                return DEVICE_CODE
              }
              throw new Error(
                `${provider} has no sign-in that works from another device.`,
              )
            },
            notify: (event) => {
              if (event.type === 'auth_url') {
                update({ url: event.url })
              } else if (event.type === 'device_code') {
                update({ url: event.verificationUri, code: event.userCode })
              }
            },
          },
          login,
        )
        .then(
          () => set({ status: 'signed-in' }),
          async (error: unknown) => {
            if (lifetime.state === 'closed') {
              return
            }
            const after = await stored()
            set(
              controller.signal.aborted || after.status === 'signed-in'
                ? after
                : {
                    status: after.status,
                    error:
                      error instanceof Error ? error.message : String(error),
                  },
            )
          },
        )
        .finally(() => {
          if (signingIn === controller) {
            signingIn = undefined
          }
        })
    },
    answer: (text) => answer?.(text),
    cancelSignIn: () => signingIn?.abort(),
    signOut: async () => {
      if (lifetime.state === 'closed') {
        return
      }
      signingIn?.abort()
      await models.logout(provider)
      set({ status: 'signed-out' })
    },
  }

  /**
   * Called with every final response. A failure may mean the login stopped
   * working, so check it; any success means it works.
   */
  const noteResponse = async (message: AssistantMessage) => {
    if (
      lifetime.state === 'closed' ||
      message.provider !== provider ||
      state.status === 'signing-in'
    ) {
      return
    }
    if (message.stopReason !== 'error') {
      if (state.status !== 'signed-in') {
        set({ status: 'signed-in' })
      }
      return
    }
    const next = await working()
    // A sign-in may have started while the check ran; it owns the state now.
    const current = api.state().status
    if (next.status !== current && current !== 'signing-in') {
      set(next)
    }
  }

  const account: Account = {
    api,
    close: () => {
      lifetime.state = 'closed'
      signingIn?.abort()
      listeners.clear()
    },
  }
  attachments.set(account, { models, provider, lifetime, noteResponse })
  return account
}

/**
 * The Pi extension that lets `account` notice when its login stops working.
 * Refuses an account made for other `Models` or another provider: its state
 * would describe a login the requests don't use.
 */
export function attachAccount(
  account: Account,
  models: AccountOptions['models'],
  provider: string,
): { extension: Extension; release(): void } {
  const attachment = attachments.get(account)
  if (!attachment) {
    throw new Error('account must come from createAccount().')
  }
  if (attachment.models !== models) {
    throw new Error(
      "account must be created with the same Models as summonFamiliar's.",
    )
  }
  if (attachment.provider !== provider) {
    throw new Error(
      `account is for ${attachment.provider}, but the model is from ${provider}.`,
    )
  }
  if (attachment.lifetime.state !== 'available') {
    throw new Error(`account is already ${attachment.lifetime.state}.`)
  }
  attachment.lifetime.state = 'attached'
  const extension = defineExtension({
    name: 'familiar.account',
    hooks: [
      hook(GenerationTask, {
        // Not awaited: a token refresh shouldn't hold up the run.
        afterResponse: (message) => void attachment.noteResponse(message),
      }),
    ],
  })
  return {
    extension,
    release: () => {
      if (attachment.lifetime.state === 'attached') {
        attachment.lifetime.state = 'available'
      }
    },
  }
}
