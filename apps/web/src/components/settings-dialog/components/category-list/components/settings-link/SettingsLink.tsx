import { CaretRightIcon } from '@phosphor-icons/react'
import { cn } from 'cn'
import type { SettingsLinkProps } from './types'

/**
 * One item in the list: a category's link, or an action's trigger, which
 * passes its own props, such as `onClick`, through.
 */
export const SettingsLink = ({
  item,
  className,
  ...props
}: SettingsLinkProps) => (
  <button
    type="button"
    {...props}
    className={cn(
      'flex h-10 w-full items-center gap-2.5 px-2 text-left text-sm hover:bg-muted aria-[current=page]:bg-muted md:h-8 md:text-xs',
      item.danger && 'text-destructive',
      className,
    )}
  >
    <item.icon className="size-4 shrink-0" />
    <span className="flex-1 truncate">{item.label}</span>
    {item.badge}
    <CaretRightIcon className="size-4 text-muted-foreground md:hidden" />
  </button>
)
