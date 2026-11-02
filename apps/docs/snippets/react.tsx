import { createFamiliarStore } from '@familiar-ai/client'
import {
  FamiliarProvider,
  useFamiliar,
  useTranscript,
} from '@familiar-ai/client/react'

// Once, outside render. The provider never opens or closes it.
const store = createFamiliarStore('/api')

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
