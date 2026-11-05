import type { Author } from '@familiar-ai/core'

/**
 * The people this page signs in. In a real app each comes from the host's own
 * sign-in; here each gets a simulated session in the same page.
 */
export const PEOPLE: Author[] = [
  { id: 'ana', name: 'Ana' },
  { id: 'ben', name: 'Ben' },
  { id: 'chloe', name: 'Chloe' },
]
