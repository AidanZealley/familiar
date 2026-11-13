import { MemoryEpisodes } from '@/components/memory-episodes'
import { MemoryFacts } from '@/components/memory-facts'
import { MemoryHistory } from '@/components/memory-history'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { memorySections } from '@/lib/memory-sections'
import { MemoryModel } from './components/memory-model'
import type { MemorySettingsProps } from './types'

const pages = {
  facts: MemoryFacts,
  history: MemoryHistory,
  episodes: MemoryEpisodes,
}

/** What memory upkeep runs on, and memory's three views, which were its pages, as tabs. */
export const MemorySettings = ({ familiar }: MemorySettingsProps) => (
  <div className="flex flex-col gap-6">
    <MemoryModel familiar={familiar} />
    <Tabs defaultValue="facts" className="gap-4">
      <TabsList>
        {memorySections.map((section) => (
          <TabsTrigger key={section.value} value={section.value}>
            <section.icon />
            {section.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {memorySections.map((section) => {
        const Page = pages[section.value]
        return (
          <TabsContent
            key={section.value}
            value={section.value}
            className="flex flex-col gap-4 text-sm"
          >
            <p className="text-xs text-muted-foreground">
              {section.description}
            </p>
            <Page />
          </TabsContent>
        )
      })}
    </Tabs>
  </div>
)
