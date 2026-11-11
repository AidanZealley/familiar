import { SettingsIcon } from 'lucide-react'
import { Item, ItemContent, ItemMedia, ItemTitle } from '@/components/ui/item'
import { openDialog } from '@/lib/dialogs'

/** The one Settings. */
export const SettingsLink = () => (
  <footer className="shrink-0 border-t p-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))]">
    <Item
      size="xs"
      className="px-2"
      render={
        <button
          type="button"
          onClick={() => openDialog({ kind: 'settings' })}
        />
      }
    >
      <ItemMedia variant="icon">
        <SettingsIcon />
      </ItemMedia>
      <ItemContent>
        <ItemTitle className="text-sm">Settings</ItemTitle>
      </ItemContent>
    </Item>
  </footer>
)
