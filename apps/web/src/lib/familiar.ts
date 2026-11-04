import { createFamiliarStore, type HttpApi } from '@familiar-ai/client'
import { createFamiliarBindings } from '@familiar-ai/client/react'

/** The daemon serves every route, so the app is typed by the whole API. */
export const { FamiliarProvider, useFamiliar, useTranscript } =
  createFamiliarBindings<HttpApi>()

/** The app owns this connection for its lifetime. */
export const familiar = createFamiliarStore<HttpApi>('/api')
