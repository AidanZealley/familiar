import type { LoginOptions, Models } from '@earendil-works/pi-ai'
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
   * Starts signing in, unless it already is. The page to open arrives in the
   * state.
   */
  signIn(): void
  /** The address the browser ended on, when the state asks to `paste` it. */
  answer(text: string): void
  cancelSignIn(): void
  signOut(): Promise<void>
}

/** How a Familiar lets its owner sign in to its `model`'s provider. */
export type AccountOptions = {
  /**
   * What the host tells the provider about itself when signing in. ChatGPT
   * needs `getDeviceId`: OpenAI identifies the app's logins by it.
   */
  login?: LoginOptions
}

type Account = {
  api: AccountApi
  /** Lets the account notice when a reply fails because the login stopped working. */
  extension: Extension
  /** Stops any unfinished sign-in and every listener. The stored login stays. */
  close(): void
}

/**
 * The owner's login with `provider`. It signs in through the same `models`
 * every request uses, so a new login applies without a restart.
 */
export async function createAccount(
  models: Pick<Models, 'checkAuth' | 'getAuth' | 'login' | 'logout'>,
  provider: string,
  { login }: AccountOptions,
): Promise<Account> {
  const listeners = new Set<(state: AccountState) => void>()
  let signingIn: AbortController | undefined
  let answer: ((text: string) => void) | undefined
  let closed = false

  // After close, a login or check still finishing changes nothing.
  const set = (next: AccountState) => {
    if (closed) {
      return
    }
    state = next
    listeners.forEach((listener) => listener(next))
  }

  // Whether a login is stored, without touching the network.
  const stored = async (): Promise<AccountState> =>
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

  let state = await stored()

  const signIn = () => {
    if (signingIn || closed) {
      return
    }
    const controller = new AbortController()
    signingIn = controller
    set({ status: 'signing-in' })

    // Changes the sign-in's state while it's still the one running.
    const update = (change: { url?: string; paste?: boolean }) => {
      if (signingIn === controller && state.status === 'signing-in') {
        set({ ...state, ...change })
      }
    }

    // Waits for `answer`, until the flow stops asking: it was cancelled, or
    // the browser returned to this machine by itself.
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
            if (prompt.type === 'manual_code') {
              return pasted(prompt.signal)
            }
            throw new Error(`${provider}'s sign-in asks for a ${prompt.type}.`)
          },
          notify: (event) => {
            if (event.type === 'auth_url') {
              update({ url: event.url })
            }
          },
        },
        login,
      )
      .then(
        () => set({ status: 'signed-in' }),
        async (error: unknown) => {
          const after = await stored()
          set(
            controller.signal.aborted || after.status === 'signed-in'
              ? after
              : {
                  status: 'signed-out',
                  error: error instanceof Error ? error.message : String(error),
                },
          )
        },
      )
      .finally(() => {
        if (signingIn === controller) {
          signingIn = undefined
        }
      })
  }

  const api: AccountApi = {
    state: () => state,
    onChange: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    signIn,
    answer: (text) => answer?.(text),
    cancelSignIn: () => signingIn?.abort(),
    signOut: async () => {
      if (closed) {
        return
      }
      signingIn?.abort()
      await models.logout(provider)
      set({ status: 'signed-out' })
    },
  }

  // A failed reply may mean the login stopped working, so check it; any
  // successful one means it works.
  const extension = defineExtension({
    name: 'familiar.account',
    hooks: [
      hook(GenerationTask, {
        afterResponse: (message) => {
          if (message.provider !== provider || state.status === 'signing-in') {
            return
          }
          if (message.stopReason !== 'error') {
            if (state.status !== 'signed-in') {
              set({ status: 'signed-in' })
            }
            return
          }
          // Not awaited: a token refresh shouldn't hold up the run.
          void working().then((next) => {
            // A sign-in may have started while the check ran; it owns the state now.
            if (next.status !== state.status && state.status !== 'signing-in') {
              set(next)
            }
          })
        },
      }),
    ],
  })

  return {
    api,
    extension,
    close: () => {
      closed = true
      signingIn?.abort()
      listeners.clear()
    },
  }
}
