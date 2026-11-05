import { createFamiliarStore } from '@familiar-ai/client'
import {
  FamiliarProvider,
  useFamiliar,
  useTranscript,
  useFamiliarStore,
} from '@familiar-ai/client/react'

// Once, at module scope. The provider never opens or closes the store.
const store = createFamiliarStore('/api')

const Chat = () => {
  const connection = useFamiliar((state) => state.connection)
  const {
    conversation: { send },
  } = useFamiliarStore()
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
