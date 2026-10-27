import { FactItem } from '../fact-item'
import type { FactListProps } from './types'

export const FactList = ({
  title,
  icon: Icon,
  description,
  facts,
}: FactListProps) =>
  facts.length > 0 && (
    <section>
      <header className="flex items-center gap-3 border-b pb-3">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-baseline gap-2 font-heading text-lg leading-tight font-medium">
            {title}
            <span className="font-sans text-sm font-normal text-muted-foreground tabular-nums">
              {facts.length}
            </span>
          </h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-[1.125rem]" />
        </span>
      </header>
      <ul className="mt-1 flex flex-col">
        {facts.map((fact) => (
          <FactItem key={fact.id} fact={fact} />
        ))}
      </ul>
    </section>
  )
