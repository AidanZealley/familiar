import {
  CaretLeftIcon,
  MagnifyingGlassIcon,
  XIcon,
} from '@phosphor-icons/react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group'
import { useDialogCategory, useDialogs } from '@/lib/dialogs'
import { useIsPhone } from '@/lib/media'
import { CategoryBody } from './components/category-body'
import { CategoryList } from './components/category-list'
import type { SettingsCategory, SettingsDialogProps } from './types'

const matches = (category: SettingsCategory, query: string) =>
  [
    category.label,
    typeof category.description === 'string' ? category.description : '',
    category.keywords ?? '',
  ]
    .join(' ')
    .toLowerCase()
    .includes(query.trim().toLowerCase())

/**
 * The one settings shell: a title bar with Close, a searchable list of
 * categories, and the chosen category beside it. On a phone it fills the
 * screen: the list, then each category as a screen with Back. The URL owns
 * which category is shown, so a link can open one.
 */
export const SettingsDialog = ({
  title,
  media,
  groups,
}: SettingsDialogProps) => {
  const isPhone = useIsPhone()
  const category = useDialogCategory()
  const { showCategory, close } = useDialogs()
  const [query, setQuery] = useState('')
  const all = groups.flatMap((group) => group.categories)
  const current =
    all.find((each) => each.id === category) ?? (isPhone ? undefined : all[0])
  const visible = groups
    .map((group) => ({
      ...group,
      categories: group.categories.filter((each) => matches(each, query)),
    }))
    .filter((group) => group.categories.length > 0)

  const list = (
    <div className="flex flex-col gap-3">
      <InputGroup>
        <InputGroupAddon>
          <MagnifyingGlassIcon />
        </InputGroupAddon>
        <InputGroupInput
          type="search"
          placeholder="Search settings"
          aria-label="Search settings"
          autoComplete="off"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            const first = visible[0]?.categories[0]
            if (event.key === 'Enter' && first) {
              showCategory(first.id)
            }
          }}
        />
      </InputGroup>
      <CategoryList
        groups={visible}
        current={current?.id}
        onShow={showCategory}
      />
      {visible.length === 0 && (
        <p className="px-2 py-4 text-xs text-muted-foreground">
          No settings match “{query.trim()}”.
        </p>
      )}
    </div>
  )

  return (
    <Dialog open onOpenChange={(open) => !open && void close()}>
      <DialogContent
        showCloseButton={false}
        className="flex flex-col gap-0 overflow-hidden p-0 max-md:inset-0 max-md:h-(--app-height) max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0 max-md:ring-0 md:h-[min(44rem,calc(100dvh-4rem))] md:max-w-4xl"
      >
        {/* On a phone it fills the screen, so its header matches the app's.
            Its buttons' icons, not their padding, line up with the content:
            the close button's 10px inset is inside the right padding. */}
        <header className="flex shrink-0 items-center gap-2 border-b pt-(--status-bar) pr-1.5 pl-4 max-md:h-(--chrome) md:pr-3 md:pl-3">
          <div className="flex h-12 min-w-0 flex-1 items-center gap-2 max-md:h-full">
            {isPhone && current ? (
              <Button
                variant="ghost"
                size="icon-lg"
                aria-label="All settings"
                className="-ml-2.5"
                onClick={() => showCategory(undefined)}
              >
                <CaretLeftIcon />
              </Button>
            ) : (
              media
            )}
            <DialogTitle className="min-w-0 truncate font-heading text-sm font-medium">
              {isPhone && current ? current.label : title}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {title}, by category.
            </DialogDescription>
            <DialogClose
              render={
                <Button
                  variant="ghost"
                  size="icon-lg"
                  className="ml-auto"
                  aria-label="Close"
                />
              }
            >
              <XIcon />
            </DialogClose>
          </div>
        </header>

        {isPhone ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            {current ? (
              <CategoryBody category={current} heading={false} />
            ) : (
              <div className="p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                {list}
              </div>
            )}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
            <aside className="w-60 shrink-0 overflow-y-auto border-r p-3">
              {list}
            </aside>
            <div className="min-w-0 flex-1 overflow-y-auto">
              {current && <CategoryBody key={current.id} category={current} />}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
