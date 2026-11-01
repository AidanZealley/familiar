import { createFamiliarStore } from '@familiar-ai/client'

/** The app owns this connection for its lifetime. */
export const familiar = createFamiliarStore('/api')
