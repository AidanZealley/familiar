import { RotateCcwIcon } from 'lucide-react'
import { startTransition, useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Chat } from '@/components/chat'
import { PersonSwitcher } from '@/components/person-switcher'
import { startDemo } from '@/demo/demo'
import { PEOPLE } from '@/demo/people'
import { FamiliarProvider } from '@/demo/react'
import type { AppProps } from './types'

export const App = ({ initialDemo }: AppProps) => {
  // Every client, session and message lives in this one demo, and this is
  // the one place that decides whose client is in front.
  const [demo, setDemo] = useState(initialDemo)
  const [active, setActive] = useState(PEOPLE[0].id)
  const [resetting, startReset] = useTransition()

  const reset = () =>
    startReset(async () => {
      await demo.stop()
      const next = await startDemo(PEOPLE)
      startTransition(() => setDemo(next))
    })

  return (
    <div className="flex h-svh flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <h1 className="font-heading text-sm font-medium">
          Shared conversation
        </h1>
        <span className="hidden text-muted-foreground sm:inline">
          A Familiar demo that runs in your browser
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          disabled={resetting}
          onClick={reset}
        >
          <RotateCcwIcon data-icon="inline-start" />
          Reset
        </Button>
      </header>
      <main className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col text-xs/relaxed">
        <p className="border-b px-4 py-2 text-muted-foreground">
          {PEOPLE.map((person) => person.name).join(', ')} each have a simulated
          session in this page, all talking to one Familiar in one conversation.
          Other tabs and visitors aren't joined.
        </p>
        {/* Every person's chat stays mounted with its own client and draft;
            only the chosen one shows. A new session remounts it on Reset. */}
        <div className="grid min-h-0 flex-1 grid-rows-1">
          {demo.clients.map(({ sessionId, author, store }) => (
            <FamiliarProvider key={sessionId} store={store}>
              <Chat
                author={author}
                people={PEOPLE}
                hidden={author.id !== active}
                switcher={
                  <PersonSwitcher
                    people={PEOPLE}
                    value={active}
                    onValueChange={setActive}
                  />
                }
              />
            </FamiliarProvider>
          ))}
        </div>
      </main>
    </div>
  )
}
