import { cn } from 'cn'
import { CaretRightIcon } from '@phosphor-icons/react'
import { Fragment } from 'react'
import { Separator } from '@/components/ui/separator'
import type { CategoryListProps } from './types'

/** The categories, grouped: a menu beside the content, or a phone's first screen. */
export const CategoryList = ({
  groups,
  current,
  onShow,
}: CategoryListProps) => (
  <nav aria-label="Settings" className="flex flex-col">
    {groups.map((group, index) => (
      <Fragment key={group.label ?? index}>
        {index > 0 && <Separator className="my-2" />}
        {group.label && (
          <h3 className="px-2 pt-1 pb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            {group.label}
          </h3>
        )}
        <ul className="flex flex-col gap-0.5">
          {group.categories.map((category) => (
            <li key={category.id}>
              <button
                type="button"
                aria-current={category.id === current ? 'page' : undefined}
                onClick={() => onShow(category.id)}
                className={cn(
                  'flex h-10 w-full items-center gap-2.5 px-2 text-left text-sm hover:bg-muted aria-[current=page]:bg-muted md:h-8 md:text-xs',
                  category.danger && 'text-destructive',
                )}
              >
                <category.icon className="size-4 shrink-0" />
                <span className="flex-1 truncate">{category.label}</span>
                {category.badge}
                <CaretRightIcon className="size-4 text-muted-foreground md:hidden" />
              </button>
            </li>
          ))}
        </ul>
      </Fragment>
    ))}
  </nav>
)
