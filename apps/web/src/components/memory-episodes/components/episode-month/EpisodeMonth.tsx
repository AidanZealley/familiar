import { cn } from 'cn'
import { formatSpan } from '@/lib/format'
import type { EpisodeMonthProps } from './types'

export const EpisodeMonth = ({ month }: EpisodeMonthProps) => {
  return (
    <section className="pt-4">
      <h2 className="sticky top-0 z-10 -mx-1 bg-background px-1 py-2 font-medium">
        {month.label}
      </h2>
      <p
        className={cn(
          'mb-3 bg-muted/50 p-3 text-sm leading-relaxed',
          !month.summary && 'text-muted-foreground',
        )}
      >
        {month.summary?.text ??
          'Still under way: summarised on the 1st of next month.'}
      </p>
      {month.entries.length > 0 && (
        <ol className="border-l pl-4 sm:ml-2">
          {month.entries.map((episode) => (
            <li key={episode.id} className="relative py-2.5">
              <span
                className={cn(
                  'absolute top-4 -left-[21px] size-2.5 border-2 border-background',
                  episode.span === 'week'
                    ? 'bg-foreground/50'
                    : 'bg-foreground/25',
                )}
              />
              <p className="text-xs text-muted-foreground">
                {episode.span === 'week'
                  ? `Week · ${formatSpan(episode)}`
                  : formatSpan(episode)}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground italic">
                {episode.text}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
