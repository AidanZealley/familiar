import { OpenaiSignIn } from './components/openai-sign-in'
import { ProviderKeys } from './components/provider-keys'

/**
 * Every model provider's access in one place: OpenAI through the ChatGPT
 * sign-in, which the workspace owns, then the others' API keys, which the
 * daemon keeps.
 */
export const Providers = () => (
  <div className="flex flex-1 flex-col gap-6">
    <OpenaiSignIn />
    <ProviderKeys />
  </div>
)
