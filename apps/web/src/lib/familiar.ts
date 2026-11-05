import { createFamiliarStore } from '@familiar-ai/client'

export {
  FamiliarProvider,
  useFamiliar,
  useFamiliarStore,
  useTranscript,
} from '@familiar-ai/client/react'

/** The app owns this connection for its lifetime. */
export const familiar = createFamiliarStore('/api')
