import { RotateCcwIcon } from 'lucide-react'
import { startTransition, useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Chat } from '@/components/chat'
import { startDemo } from '@/demo/demo'
import { PEOPLE } from '@/demo/people'
import { FamiliarProvider } from '@/demo/react'
import type { AppProps } from './types'

export const App = ({ initialDemo }: AppProps) => {
  // Every client, session and message lives in this one demo.
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
      <Tabs
        value={active}
        onValueChange={setActive}
        className="mx-auto min-h-0 w-full max-w-2xl flex-1 gap-0"
      >
        <div className="flex flex-col gap-2 border-b px-4 py-3 text-xs/relaxed">
          <div className="flex items-center gap-2">
            <span id="people" className="text-muted-foreground">
              Signed in as
            </span>
            <TabsList aria-labelledby="people">
              {PEOPLE.map((person) => (
                <TabsTrigger key={person.id} value={person.id}>
                  {person.name}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <p className="text-muted-foreground">
            {PEOPLE.map((person) => person.name).join(', ')} each have a
            simulated session in this page, all talking to one Familiar in one
            conversation. Other tabs and visitors aren't joined.
          </p>
        </div>
        {demo.clients.map(({ sessionId, author, store }) => (
          <TabsContent key={sessionId} value={author.id} className="min-h-0">
            <FamiliarProvider store={store}>
              <Chat author={author} people={PEOPLE} />
            </FamiliarProvider>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
