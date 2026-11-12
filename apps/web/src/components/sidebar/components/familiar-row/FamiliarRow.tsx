import { Link } from '@tanstack/react-router'
import { PixelAvatar } from '@/components/pixel-avatar'
import { Item, ItemMedia } from '@/components/ui/item'
import { RowSummary } from '../row-summary'
import type { FamiliarRowProps } from './types'

/** A Familiar, opening its DM: its portrait, talking while it replies there, and the DM's latest entry. */
export const FamiliarRow = ({ familiar, dm }: FamiliarRowProps) => (
  <Item
    size="xs"
    className="gap-2.5 px-2 data-[status=active]:bg-muted"
    render={
      <Link to="/dm/$familiar" params={{ familiar: String(familiar.id) }} />
    }
  >
    <ItemMedia>
      <PixelAvatar
        familiar={familiar}
        talking={!!dm?.turns.some((turn) => turn.status === 'running')}
      />
    </ItemMedia>
    <RowSummary title={familiar.name} room={dm} />
  </Item>
)
