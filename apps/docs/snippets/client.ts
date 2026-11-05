import { createFamiliarStore } from '@familiar-ai/client'
import { getCurrentToken } from './host.ts'

const store = createFamiliarStore('https://your-host.example/api', {
  // Every request, including stream reconnects, goes through this.
  fetch: async (input, init) => {
    const request = new Request(input, init)
    request.headers.set('Authorization', `Bearer ${await getCurrentToken()}`)
    return fetch(request)
  },
})

const unsubscribe = store.subscribe((state) => {
  console.log(state.connection, state.transcript?.items.length)
})

await store.conversation.send('Hello')

// On sign-out, or when this view goes away:
unsubscribe()
store.disconnect()
