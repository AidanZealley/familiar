import { createFamiliarStore } from '@familiar-ai/client'
import { createFamiliarBindings } from '@familiar-ai/client/react'
import type { Api } from './serve.ts'

// Once, at module scope. The provider never opens or closes the store.
const { FamiliarProvider, useFamiliar, useTranscript } =
  createFamiliarBindings<Api>()
const store = createFamiliarStore<Api>('/api')

const Chat = () => {
  const connection = useFamiliar((state) => state.connection)
  const send = useFamiliar((state) => state.conversation.send)
  const transcript = useTranscript()

  if (connection !== 'open') {
    return <p>{connection}…</p>
  }
  return (
    <>
      <ul>
        {transcript?.items.map((item) => (
          <li key={item.id}>
            {item.type === 'message' && item.text}
            {item.type === 'reply' && item.text}
          </li>
        ))}
      </ul>
      <button onClick={() => void send('Hello')}>Say hello</button>
    </>
  )
}

export const App = () => (
  <FamiliarProvider store={store}>
    <Chat />
  </FamiliarProvider>
)
