import type { IconTileProps } from './types'

/** A section's icon on a tinted square, beside its heading. */
export const IconTile = ({ icon: Icon }: IconTileProps) => (
  <span className="grid size-9 shrink-0 place-items-center bg-primary/10 text-primary dark:bg-primary/70 dark:text-foreground">
    <Icon className="size-[1.125rem]" />
  </span>
)
