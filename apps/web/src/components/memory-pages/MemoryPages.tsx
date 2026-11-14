import { useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useFamiliar } from '@/lib/familiar'
import { Journal } from './components/journal'
import { PromptSection } from './components/prompt-section'
import { SubjectList } from './components/subject-list'
import { SubjectPage } from './components/subject-page'
import type { MemoryPagesProps } from './types'

/**
 * A Familiar's memory, in the model's own terms: its subjects (each a page
 * of notes with a profile), its journal, and the prompt section it always
 * sees. A subject's page opens in place of the list; changing tab closes it.
 */
export const MemoryPages = ({ familiar }: MemoryPagesProps) => {
  const memory = useFamiliar((state) => state.memory)
  const [tab, setTab] = useState('subjects')
  const [open, setOpen] = useState<string>()
  const subject = memory?.subjects.find((each) => each.id === open)

  if (!memory) {
    return null
  }

  return (
    <Tabs
      value={tab}
      onValueChange={(value: string) => {
        setTab(value)
        setOpen(undefined)
      }}
      className="gap-4"
    >
      <TabsList>
        <TabsTrigger value="subjects">Subjects</TabsTrigger>
        <TabsTrigger value="journal">Journal</TabsTrigger>
        <TabsTrigger value="prompt">Prompt</TabsTrigger>
      </TabsList>
      <TabsContent value="subjects">
        {subject ? (
          <SubjectPage
            familiar={familiar}
            subject={subject}
            onBack={() => setOpen(undefined)}
          />
        ) : (
          <SubjectList
            familiar={familiar}
            subjects={memory.subjects}
            onOpen={setOpen}
          />
        )}
      </TabsContent>
      <TabsContent value="journal">
        <Journal familiar={familiar} months={memory.months} />
      </TabsContent>
      <TabsContent value="prompt">
        <PromptSection familiar={familiar} memory={memory} />
      </TabsContent>
    </Tabs>
  )
}
