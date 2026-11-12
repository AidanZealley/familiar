import { PlusIcon } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import type { SectionHeadingProps } from './types'

/** A sidebar section's heading, with a button to add to it. */
export const SectionHeading = ({
  icon: Icon,
  label,
  addLabel,
  onAdd,
}: SectionHeadingProps) => (
  <div className="flex items-center justify-between py-1 pr-0.5 pl-2">
    <h2 className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
      <Icon className="size-3" />
      {label}
    </h2>
    <Button
      variant="secondary"
      size="icon-sm"
      aria-label={addLabel}
      title={addLabel}
      onClick={onAdd}
    >
      <PlusIcon />
    </Button>
  </div>
)
