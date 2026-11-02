# @familiar-ai/client

A browser-safe live store for Familiar's HTTP/SSE API, with a derived chat transcript and optional React bindings. Familiar's web app uses the same API available to embedded clients.

```sh
npm install @familiar-ai/client
```

## Connect and send

```ts
import { createFamiliarStore } from '@familiar-ai/client'

const store = createFamiliarStore('/api')
const unsubscribe = store.subscribe((state) => {
  console.log(state.connection, state.transcript?.items)
})
await store.getState().conversation.send('Hello')
// When this connection is no longer needed:
unsubscribe()
store.getState().disconnect()
```

The host assigns the message author. State groups include `conversation`, `memory`, `schedules`, `account`, `push`, `connections` and `mcp`. For example, read `state.memory.facts?.facts` and call `state.memory.revise(id, text)`. Streamed documents can be undefined before arrival or null. The store owns transcript derivation and history paging; it exposes reads and subscriptions, not `setState`.

Every request, including stream reconnects, uses the optional `fetch`:

```ts
const store = createFamiliarStore('https://your-host.example/api', {
  fetch: async (input, init) => {
    const request = new Request(input, init)
    request.headers.set('Authorization', `Bearer ${await getCurrentToken()}`)
    return fetch(request)
  },
})
```

`getCurrentToken` is your host's credential code. An open stream keeps its initial credentials until reconnect. Disconnect and create a new store after sign-out or an identity change. Commands reject with the server's error and are not retried automatically; already-sent commands still settle after disconnect.

`connection` starts as `connecting` and becomes `open` after a compatible protocol handshake and full view. Network errors reconnect with fresh state. `unauthorized`, `failed` and `outdated` stop retries. The host decides whether to sign in, replace the store or reload; the library never reloads the page.

## React, optionally

Install React 18 or 19 in your app, then use the separate entry:

```tsx
import { createFamiliarStore } from '@familiar-ai/client'
import {
  FamiliarProvider,
  useFamiliar,
  useTranscript,
} from '@familiar-ai/client/react'

const store = createFamiliarStore('/api')
const Chat = () => {
  const connection = useFamiliar((state) => state.connection)
  const transcript = useTranscript()
  return (
    <p>
      {connection}: {transcript?.items.length ?? 0} items
    </p>
  )
}
export const App = () => (
  <FamiliarProvider store={store}>
    <Chat />
  </FamiliarProvider>
)
```

Create the store once in your app's connection lifecycle, outside render. The provider does not open or close it; the caller disconnects it. Selectors use `Object.is`, so return stable references. Vanilla imports do not load React or core's server runtime.

For custom hosts, `createFamiliarStore<HostApi>()` and `createFamiliarBindings<HostApi>()` narrow commands to complete mounted route groups. This checks types, not permissions or streamed sources. See the [typed host guide](../../docs/typed-host-client.md) and [example](../../examples/typed-host/README.md).
