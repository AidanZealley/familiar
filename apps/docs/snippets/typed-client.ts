import { createFamiliarStore } from '@familiar-ai/client'
import { createFamiliarBindings } from '@familiar-ai/client/react'
import type { HostApi } from './compose-routes.ts'

// Commands narrow to the routes HostApi mounts.
export const store = createFamiliarStore<HostApi>('/api')
export const { FamiliarProvider, useFamiliar, useTranscript } =
  createFamiliarBindings<HostApi>()
