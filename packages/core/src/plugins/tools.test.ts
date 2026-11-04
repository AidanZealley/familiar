import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { createModels } from '@earendil-works/pi-ai/models'
import type { ToolExecutionApi } from '@earendil-works/pi-durable'
import { expect, test } from 'vitest'
import { defineTool, Type } from './tools.ts'

test('the invoker reaches the tool through live API getters', async () => {
  const first = createModels()
  const second = createModels()
  let current = first
  // Only invoker lookup (no such task) and the live getter are exercised.
  const api = {
    taskId: 1,
    commit: async (change: (tx: unknown) => unknown) =>
      change({ task: async () => undefined }),
    get models() {
      return current
    },
  } as unknown as ToolExecutionApi
  const tool = defineTool({
    name: 'live_models',
    description: 'Check the current models during a call.',
    parameters: Type.Object({}),
    execute: async (_args, invocation) => {
      expect(invocation.invoker).toEqual({ kind: 'unknown' })
      expect(invocation.models).toBe(first)
      current = second
      expect(invocation.models).toBe(second)
      return { output: [] }
    },
  })

  expect(await tool.execute({}, api, BACKGROUND_CONTEXT)).toEqual({
    output: [],
  })
})
