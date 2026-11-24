import { ArchiveIcon } from '@phosphor-icons/react'

/** In place of the composer, in a room that takes no new messages. */
export const ArchivedNotice = () => (
  <p className="mx-4 mt-2 mb-[max(1rem,env(safe-area-inset-bottom))] flex items-center justify-center gap-1.5 border border-dashed bg-background/80 p-3 text-xs text-muted-foreground backdrop-blur-xl">
    <ArchiveIcon className="size-3.5" />
    Archived: its history stays, and it takes no new messages.
  </p>
)
