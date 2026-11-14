import { JournalMonth } from './components/journal-month'
import type { JournalProps } from './types'

/** The journal's months, newest first. */
export const Journal = ({ familiar, months }: JournalProps) => (
  <div className="flex flex-col gap-4">
    <p className="text-xs text-muted-foreground">
      Dated lines, one per thing worth finding again, each pointing at the
      conversation it came from. {familiar.name} searches them; they’re never in
      the prompt.
    </p>
    {months.length === 0 ? (
      <p className="text-xs text-muted-foreground">Nothing yet.</p>
    ) : (
      months
        .toReversed()
        .map((month) => (
          <JournalMonth key={month} familiar={familiar} month={month} />
        ))
    )}
  </div>
)
