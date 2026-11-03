import { createFamiliarBindings } from '@familiar-ai/client/react'
import type { HostApi } from './demo.ts'

export const { FamiliarProvider, useFamiliar, useTranscript } =
  createFamiliarBindings<HostApi>()
