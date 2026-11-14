import { ChatModel } from './components/chat-model'
import { MemoryModel } from './components/memory-model'
import type { ModelsSettingsProps } from './types'

/** What a Familiar's chat and memory run on, each the default or its own. */
export const ModelsSettings = ({ familiar }: ModelsSettingsProps) => (
  <div className="flex flex-col gap-6 text-sm">
    <ChatModel familiar={familiar} />
    <MemoryModel familiar={familiar} />
  </div>
)
