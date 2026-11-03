import { RotateCcwIcon } from 'lucide-react'
import { startTransition, useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Chat } from '@/components/chat'
import { Composer } from '@/components/composer'
import { PersonSwitcher } from '@/components/person-switcher'
import { Suggestions } from '@/components/suggestions'
import { startDemo } from '@/demo/demo'
import { PEOPLE } from '@/demo/people'
import { FamiliarProvider } from '@/demo/react'
import { suggestedPrompts } from '@/demo/script'
import type { AppProps } from './types'

export const App = ({ initialDemo }: AppProps) => {
  // Every client, session and message lives in this one demo, and this is
  // the one place that decides whose client is in front.
  const [demo, setDemo] = useState(initialDemo)
  const [active, setActive] = useState(PEOPLE[0].id)
  const [resetting, startReset] = useTransition()
  const [reader] = demo.clients
  const sender = demo.clients.find(({ author }) => author.id === active)!

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
        {/* One shared transcript, read through the first person's client.
            Every client is connected and mirrors the same conversation; the
            person sending only decides whose messages sit on the right. */}
        <FamiliarProvider key={reader.sessionId} store={reader.store}>
          <Chat viewer={sender.author} />
        </FamiliarProvider>
        <div className="flex shrink-0 flex-col gap-3 border-t p-3">
          {/* Only the sender's suggestions, through the sender's client. */}
          <FamiliarProvider key={sender.sessionId} store={sender.store}>
            <Suggestions prompts={suggestedPrompts(sender.author, PEOPLE)} />
          </FamiliarProvider>
          <PersonSwitcher
            people={PEOPLE}
            value={active}
            onValueChange={setActive}
          />
          {/* Each person's message box, bound to their own client, keeps its
              draft while hidden. A new session on Reset remounts it. */}
          {demo.clients.map(({ sessionId, author, store }) => (
            <FamiliarProvider key={sessionId} store={store}>
              <div hidden={author.id !== active}>
                <Composer name={author.name} />
              </div>
            </FamiliarProvider>
          ))}
        </div>
      </main>
    </div>
  )
}
