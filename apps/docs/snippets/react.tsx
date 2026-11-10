import { createRoomStore } from '@familiar-ai/client'
import { RoomProvider, useRoom, useRoomStore } from '@familiar-ai/client/react'

// Once, at module scope, for the room this page shows, such as one a host
// made for everyone signed in. The provider never opens or closes the store.
declare const roomId: number
const store = createRoomStore('/api', roomId)

const Chat = () => {
  const connection = useRoom((state) => state.connection)
  const { send } = useRoomStore()
  const transcript = useRoom((state) => state.transcript)

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
  <RoomProvider store={store}>
    <Chat />
  </RoomProvider>
)
