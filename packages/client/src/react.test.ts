// @vitest-environment jsdom
import { act, createElement, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { FamiliarProvider, useFamiliar, useTranscript } from './react.ts'
import { createFamiliarStore, type FamiliarStore } from './store.ts'
import { frame, testServer, view } from './testing.ts'

let root: Root
let container: HTMLDivElement
const stores: FamiliarStore[] = []
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  root = createRoot(container)
})
afterEach(async () => {
  await act(() => root.unmount())
  stores.splice(0).forEach((store) => store.getState().disconnect())
  vi.unstubAllGlobals()
})
const open = () => {
  const server = testServer()
  const store = createFamiliarStore('http://familiar.test/api', {
    fetch: server.fetch,
  })
  stores.push(store)
  return { server, store }
}

test('selectors update only for their selection; transcript is the store-owned value', async () => {
  const { store, server } = open()
  let renders = 0
  const Status = () => {
    const status = useFamiliar((state) => state.connection)
    renders++
    return createElement('span', null, status)
  }
  let selected: ReturnType<typeof useTranscript>
  const Transcript = () => {
    selected = useTranscript()
    return null
  }
  await act(() =>
    root.render(
      createElement(
        FamiliarProvider,
        { store },
        createElement(Status),
        createElement(Transcript),
      ),
    ),
  )
  expect(container.textContent).toBe('connecting')
  expect(selected).toBeUndefined()
  const initialRenders = renders
  await act(async () => {
    await expect.poll(server.connections).toBe(1)
    server.send(frame('account', null))
    await expect.poll(() => store.getState().account).toBeNull()
  })
  expect(renders).toBe(initialRenders)
  await act(async () => {
    await expect.poll(server.connections).toBe(1)
    server.send(frame('view', view(1)))
    await expect.poll(() => store.getState().connection).toBe('open')
  })
  expect(container.textContent).toBe('open')
  expect(selected).toBe(store.getState().transcript)
  expect(selected).toBeDefined()
})

test('nearest providers isolate stores and replacement moves the subscription without disconnecting', async () => {
  const { store: first, server: firstServer } = open()
  const { store: second, server: secondServer } = open()
  const disconnectFirst = vi.spyOn(first.getState(), 'disconnect')
  const disconnectSecond = vi.spyOn(second.getState(), 'disconnect')
  const Status = () =>
    createElement(
      'span',
      null,
      useFamiliar((s) => s.connection),
    )
  const render = (store: FamiliarStore) =>
    act(() =>
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(
            FamiliarProvider,
            { store: first },
            createElement(Status),
            createElement(FamiliarProvider, { store }, createElement(Status)),
          ),
          createElement(
            FamiliarProvider,
            { store: second },
            createElement(Status),
          ),
        ),
      ),
    )
  await render(second)
  await act(async () => {
    await expect.poll(firstServer.connections).toBe(1)
    firstServer.send(frame('view', view(1)))
    await expect.poll(() => first.getState().connection).toBe('open')
  })
  expect(container.textContent).toBe('openconnectingconnecting')
  await act(async () => {
    await expect.poll(secondServer.connections).toBe(1)
    secondServer.send('retry: 100000\n\n' + frame('view', view(2)))
    await expect.poll(() => second.getState().connection).toBe('open')
  })
  expect(container.textContent).toBe('openopenopen')
  await render(first)
  expect(container.textContent).toBe('openopenopen')
  await act(async () => {
    secondServer.drop()
    await expect.poll(() => second.getState().connection).toBe('reconnecting')
  })
  expect(container.textContent).toBe('openopenreconnecting')
  await act(() => root.unmount())
  expect(disconnectFirst).not.toHaveBeenCalled()
  expect(disconnectSecond).not.toHaveBeenCalled()
})

test('hooks explain a missing provider', async () => {
  const Missing = () => {
    useTranscript()
    return null
  }
  expect(() => act(() => root.render(createElement(Missing)))).toThrow(
    'useFamiliar must be used within a FamiliarProvider',
  )
})
