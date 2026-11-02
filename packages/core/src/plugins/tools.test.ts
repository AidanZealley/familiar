import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { createModels } from '@earendil-works/pi-ai/models'
import type { ToolExecutionApi } from '@earendil-works/pi-durable'
import { expect, test } from 'vitest'
import { defineTool, Type } from './tools.ts'

test('author enrichment preserves live execution API getters', async () => {
  const first = createModels()
  const second = createModels()
  let current = first
  const author = { id: 'owner', name: 'Sam' }
  // Only author lookup and the live getter are exercised by this invocation.
  const api = {
    commit: async () => author,
    get models() {
      return current
    },
  } as unknown as ToolExecutionApi
  const tool = defineTool({
    name: 'live_models',
    description: 'Check the current models during a call.',
    parameters: Type.Object({}),
    execute: async (_args, invocation) => {
      expect(invocation.author).toEqual(author)
      expect(invocation.models).toBe(first)
      current = second
      expect(invocation.models).toBe(second)
      return { output: [] }
    },
  })

  await tool.execute({}, api, BACKGROUND_CONTEXT)
})
