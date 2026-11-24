import type { DetailSectionProps } from './types'

/** A titled list in the computer's details, such as its tabs. */
export const DetailSection = ({
  title,
  icon: Icon,
  children,
}: DetailSectionProps) => (
  <section className="flex flex-col gap-1">
    <h3 className="flex items-center gap-1.5 font-medium text-muted-foreground">
      <Icon className="size-3.5 shrink-0" />
      {title}
    </h3>
    <ul className="flex flex-col gap-1">{children}</ul>
  </section>
)
