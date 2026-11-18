import type { DetailSectionProps } from './types'

/** A titled list in the computer's details, such as its tabs. */
export const DetailSection = ({ title, children }: DetailSectionProps) => (
  <section className="flex flex-col gap-1">
    <h3 className="font-medium text-muted-foreground">{title}</h3>
    <ul className="flex flex-col gap-1">{children}</ul>
  </section>
)
