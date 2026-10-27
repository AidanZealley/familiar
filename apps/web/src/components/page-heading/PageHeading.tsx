import type { PageHeadingProps } from './types'

export const PageHeading = ({ title, description }: PageHeadingProps) => (
  <header>
    <h1 className="font-heading text-2xl font-medium">{title}</h1>
    <p className="mt-1 text-sm text-muted-foreground">{description}</p>
  </header>
)
