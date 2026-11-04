# @familiar-ai/client

A browser-safe live store for Familiar's HTTP/SSE API, with a derived chat transcript and optional React bindings. Familiar's web app uses the same API available to embedded clients.

Guide and reference: [Connect a frontend](https://aidanzealley.github.io/familiar/build/connect-a-frontend/) and the [client API](https://aidanzealley.github.io/familiar/reference/client/) (the site publishes once GitHub Pages deployment is enabled).

```sh
npm install @familiar-ai/client
```

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

The host assigns the message author. Pass `{ fetch }` to attach credentials to every request, including stream reconnects. `unauthorized`, `failed` and `outdated` connections stop retrying; disconnect and create a new store after those, after sign-out or after an identity change. The library never reloads the page.

The store offers every command; a command the host's `allow` refuses rejects with its 403. React 18 or 19 bindings, `FamiliarProvider`, `useFamiliar` and `useTranscript`, come from `@familiar-ai/client/react`. The vanilla entry loads neither React nor core's server runtime.
