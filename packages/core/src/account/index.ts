import type {
  AssistantMessage,
  LoginOptions,
  Models,
} from '@earendil-works/pi-ai'
import {
  defineExtension,
  GenerationTask,
  hook,
} from '@earendil-works/pi-durable'

/**
 * Whether Familiar can reach its models' provider, as one value. `expired`
 * is a stored login the provider no longer accepts; `error` says why the
 * last sign-in failed.
 */
export type AccountState =
  | { status: 'signed-in' }
  | { status: 'signed-out' | 'expired'; error?: string }
  /** `device` arrives once the provider has issued a code. */
  | { status: 'signing-in'; device?: { code: string; url: string } }

export type AccountApi = {
  state(): AccountState
  /** Calls `listener` with each new state. Returns a function that stops it. */
  onChange(listener: (state: AccountState) => void): () => void
  /**
   * Starts a device-code sign-in, unless one is running. Its code arrives in
   * the state; the owner enters it on the provider's page from any device.
   */
  signIn(): void
  cancelSignIn(): void
  signOut(): Promise<void>
}

export type AccountOptions = {
  models: Pick<Models, 'checkAuth' | 'getAuth' | 'login' | 'logout'>
  /** The provider whose login this is: the one Familiar's models come from. */
  provider: string
  /** What the host tells the provider about itself when signing in. */
  login?: LoginOptions
}

/** pi-ai's id for the headless login that works from any device. */
const DEVICE_CODE = 'device_code'

/**
 * The owner's login with the models' provider. It signs in through the same
 * `Models` every request uses, so a new login applies without a restart.
 * Install `extension`: it notices when a request fails because the login
 * stopped working.
 */
export async function createAccount({
  models,
  provider,
  login,
}: AccountOptions) {
  const listeners = new Set<(state: AccountState) => void>()
  let state: AccountState
  let signingIn: AbortController | undefined

  const set = (next: AccountState) => {
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
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    signIn: () => {
      if (signingIn) {
        return
      }
      const controller = new AbortController()
      signingIn = controller
      set({ status: 'signing-in' })
      models
        .login(
          provider,
          'oauth',
          {
            signal: controller.signal,
            prompt: async (prompt) => {
              if (
                prompt.type === 'select' &&
                prompt.options.some((option) => option.id === DEVICE_CODE)
              ) {
                return DEVICE_CODE
              }
              // Anything else needs a terminal or a browser on this machine.
              throw new Error(`${provider} has no device code sign-in.`)
            },
            notify: (event) => {
              if (event.type === 'device_code' && !controller.signal.aborted) {
                set({
                  status: 'signing-in',
                  device: { code: event.userCode, url: event.verificationUri },
                })
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
    cancelSignIn: () => signingIn?.abort(),
    signOut: async () => {
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
    if (message.provider !== provider || state.status === 'signing-in') {
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

  const extension = defineExtension({
    name: 'familiar.account',
    hooks: [
      hook(GenerationTask, {
        // Not awaited: a token refresh shouldn't hold up the run.
        afterResponse: (message) => void noteResponse(message),
      }),
    ],
  })

  return { api, extension, noteResponse }
}
