import { GearSixIcon } from '@phosphor-icons/react'
import { useNeedsAttention } from '@/components/connections'
import { Badge } from '@/components/ui/badge'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import { useDialogs } from '@/lib/dialogs'

/** The one Settings, counting the connections that need the owner. */
export const SettingsLink = () => {
  const needsYou = useNeedsAttention()
  const { open: openDialog } = useDialogs()

  return (
    <footer className="shrink-0 border-t p-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))]">
      <Item
        size="xs"
        className="px-2 hover:bg-muted"
        render={
          <button
            type="button"
            onClick={() => openDialog({ kind: 'settings' })}
          />
        }
      >
        <ItemMedia variant="icon">
          <GearSixIcon />
        </ItemMedia>
        <ItemContent>
          <ItemTitle className="text-sm">Settings</ItemTitle>
        </ItemContent>
        {needsYou > 0 && (
          <ItemActions>
            <Badge
              variant="destructive"
              aria-label={`${needsYou} connections need you`}
            >
              {needsYou}
            </Badge>
          </ItemActions>
        )}
      </Item>
    </footer>
  )
}
