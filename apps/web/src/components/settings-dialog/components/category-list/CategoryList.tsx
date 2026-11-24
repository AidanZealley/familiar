import { Fragment } from 'react'
import { Separator } from '@/components/ui/separator'
import { SettingsLink } from './components/settings-link'
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
          {group.categories?.map((category) => (
            <li key={category.id}>
              <SettingsLink
                item={category}
                aria-current={category.id === current ? 'page' : undefined}
                onClick={() => onShow(category.id)}
              />
            </li>
          ))}
          {group.actions?.map((action) => (
            <li key={action.id}>
              {action.render(<SettingsLink item={action} />)}
            </li>
          ))}
        </ul>
      </Fragment>
    ))}
  </nav>
)
