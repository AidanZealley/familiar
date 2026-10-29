import { expect, test } from 'vitest'
import { toolResult } from './tool-result.ts'

test('preserves MCP errors and content order without fetching resources', () => {
  const image = { type: 'image' as const, data: 'AA==', mimeType: 'image/png' }
  expect(
    toolResult({
      isError: true,
      content: [
        { type: 'text', text: 'Partial result' },
        image,
        { type: 'resource_link', name: 'Notes', uri: 'file:///notes' },
        { type: 'resource', resource: { uri: 'test:///note', text: 'Hello' } },
        { type: 'resource', resource: { uri: 'test:///binary', blob: 'AA==' } },
        { type: 'audio', data: 'AA==', mimeType: 'audio/wav' },
      ],
    }),
  ).toEqual({
    isError: true,
    output: [
      { type: 'text', text: 'Partial result' },
      image,
      { type: 'text', text: 'Notes: file:///notes' },
      { type: 'text', text: 'test:///note\nHello' },
      { type: 'text', text: 'Unsupported MCP binary resource: test:///binary' },
      { type: 'text', text: 'Unsupported MCP content: audio' },
    ],
  })
})

test('includes structured output once, including scalar values', () => {
  expect(toolResult({ content: [], structuredContent: false }).output).toEqual([
    { type: 'text', text: 'false' },
  ])
  expect(
    toolResult({
      content: [{ type: 'text', text: '{"answer":42}' }],
      structuredContent: { answer: 42 },
    }).output,
  ).toEqual([{ type: 'text', text: '{"answer":42}' }])
})
