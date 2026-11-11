import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { SettingsIcon } from 'lucide-react'
import { connectionsQuery, needsAttention } from '@/components/connections'
import { Badge } from '@/components/ui/badge'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import { dialogSearch, pushedState } from '@/lib/dialogs'

/** The one Settings, saying how many connections need the person. */
export const SettingsLink = () => {
  // Checked less often than while Connections is open, which polls itself.
  const { data: connections = [] } = useQuery({
    ...connectionsQuery,
    refetchInterval: 30_000,
  })
  const needsYou = connections.filter(needsAttention).length

  return (
    <footer className="shrink-0 border-t p-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))]">
      <Item
        size="xs"
        className="px-2"
        render={
          <Link
            to="."
            search={dialogSearch({ kind: 'settings' })}
            state={(previous) => pushedState(previous)}
          />
        }
      >
        <ItemMedia variant="icon">
          <SettingsIcon />
        </ItemMedia>
        <ItemContent>
          <ItemTitle className="text-sm">Settings</ItemTitle>
        </ItemContent>
        {needsYou > 0 && (
          <ItemActions>
            <Badge variant="destructive">{needsYou} need you</Badge>
          </ItemActions>
        )}
      </Item>
    </footer>
  )
}
