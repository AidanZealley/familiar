import type { PageHeadingProps } from './types'

export const PageHeading = ({
  title,
  section,
  description,
}: PageHeadingProps) => (
  <header>
    <h1 className="font-heading text-2xl font-medium">{title}</h1>
    {section && <h2 className="mt-1 font-medium">{section}</h2>}
    <p className="mt-1 text-sm text-muted-foreground">{description}</p>
  </header>
)
