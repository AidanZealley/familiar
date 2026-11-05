import { BotIcon, RotateCcwIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { AssistantPanel } from '@/components/assistant-panel'
import { TaskBoard } from '@/components/task-board'

// Everything lives in this page's memory, so a reload starts over.
const reset = () => window.location.reload()

export const App = () => (
  <div className="flex h-svh flex-col">
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
      <div className="flex items-baseline gap-2">
        <h1 className="font-heading text-sm font-medium">Task board</h1>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          A Familiar demo that runs in your browser
        </span>
      </div>
      <div className="ml-auto flex gap-1">
        <Button variant="ghost" size="sm" onClick={reset}>
          <RotateCcwIcon data-icon="inline-start" />
          Reset
        </Button>
        <Sheet>
          <SheetTrigger render={<Button size="sm" className="lg:hidden" />}>
            <BotIcon data-icon="inline-start" />
            Assistant
          </SheetTrigger>
          <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-sm">
            <SheetTitle className="sr-only">Familiar</SheetTitle>
            <AssistantPanel />
          </SheetContent>
        </Sheet>
      </div>
    </header>
    <div className="flex min-h-0 flex-1">
      <main className="min-w-0 flex-1 overflow-y-auto p-4">
        <TaskBoard />
      </main>
      <aside className="hidden w-96 shrink-0 border-l lg:flex">
        <AssistantPanel />
      </aside>
    </div>
  </div>
)
