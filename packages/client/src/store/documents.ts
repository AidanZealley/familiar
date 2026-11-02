import { applyImmutable } from '@earendil-works/chord/delta'
import type { StreamEvent } from '@familiar-ai/core/http'
import type { FamiliarState } from './types.ts'

type DocumentUpdate =
  Pick<FamiliarState, 'memory'> | Pick<FamiliarState, 'schedules'>

export const receiveDocument = (
  { memory, schedules }: FamiliarState,
  document: Extract<StreamEvent, { event: 'document' }>['data'],
): DocumentUpdate => {
  switch (document.name) {
    case 'memory':
      return { memory: { ...memory, facts: document.value } }
    case 'episodes':
      return { memory: { ...memory, episodes: document.value } }
    case 'schedules':
      return { schedules: { ...schedules, items: document.value } }
  }
}

export const applyDocumentOps = (
  { memory, schedules }: FamiliarState,
  document: Extract<StreamEvent, { event: 'document.ops' }>['data'],
): DocumentUpdate => {
  switch (document.name) {
    case 'memory':
      return {
        memory: {
          ...memory,
          facts: applyImmutable(memory.facts ?? undefined, document.ops),
        },
      }
    case 'episodes':
      return {
        memory: {
          ...memory,
          episodes: applyImmutable(memory.episodes ?? undefined, document.ops),
        },
      }
    case 'schedules':
      return {
        schedules: {
          ...schedules,
          items: applyImmutable(schedules.items ?? undefined, document.ops),
        },
      }
  }
}
