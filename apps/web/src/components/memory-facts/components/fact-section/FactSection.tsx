import { FactItem } from '../fact-item'
import type { FactSectionProps } from './types'

/** One kind of current memory: a heading like the sidebar's, then its facts. */
export const FactSection = ({
  icon: Icon,
  title,
  description,
  facts,
}: FactSectionProps) =>
  facts.length > 0 && (
    <section className="flex flex-col gap-3">
      <header>
        <h3 className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          <Icon className="size-3" />
          {title}
          <span className="tabular-nums">{facts.length}</span>
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </header>
      <ul className="flex flex-col gap-4">
        {facts.map((fact) => (
          <FactItem key={fact.id} fact={fact} />
        ))}
      </ul>
    </section>
  )
