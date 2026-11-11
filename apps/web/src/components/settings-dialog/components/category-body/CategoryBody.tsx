import { cn } from 'cn'
import type { CategoryBodyProps } from './types'

/** A category's heading, what it's for, and its settings. */
export const CategoryBody = ({
  category,
  heading = true,
}: CategoryBodyProps) => (
  <section
    aria-label={category.label}
    className="flex flex-col gap-6 p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:p-6"
  >
    {(heading || category.description) && (
      <header className="flex flex-col gap-1">
        {heading && (
          <h2
            className={cn(
              'font-heading text-base font-medium',
              category.danger && 'text-destructive',
            )}
          >
            {category.label}
          </h2>
        )}
        {category.description && (
          <p className="text-xs text-muted-foreground">
            {category.description}
          </p>
        )}
      </header>
    )}
    {category.content}
  </section>
)
