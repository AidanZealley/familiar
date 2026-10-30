import { ChevronRightIcon } from 'lucide-react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker'
import { cn } from '@/lib/utils'
import type { ActivityProps } from './types'

/** A status line for something Familiar did, expandable to show the detail. */
export const Activity = ({
  icon,
  label,
  active,
  failed,
  children,
}: ActivityProps) => (
  <Collapsible>
    <CollapsibleTrigger
      render={
        <Marker
          render={<button type="button" />}
          className={cn(
            'group/activity w-fit cursor-pointer hover:text-foreground',
            failed && 'text-destructive hover:text-destructive',
          )}
        />
      }
    >
      <MarkerIcon>{icon}</MarkerIcon>
      <MarkerContent className={cn(active && 'shimmer')}>{label}</MarkerContent>
      <ChevronRightIcon className="size-3.5 transition-transform group-data-[panel-open]/activity:rotate-90" />
    </CollapsibleTrigger>
    <CollapsibleContent className="mt-2 ml-6 space-y-2 border bg-muted/40 p-3 font-mono text-xs">
      {children}
    </CollapsibleContent>
  </Collapsible>
)
