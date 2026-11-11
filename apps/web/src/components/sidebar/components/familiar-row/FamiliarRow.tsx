import { Link } from '@tanstack/react-router'
import { PixelAvatar } from '@/components/pixel-avatar'
import { Item, ItemContent, ItemMedia, ItemTitle } from '@/components/ui/item'
import type { FamiliarRowProps } from './types'

/** A Familiar, opening its DM. */
export const FamiliarRow = ({ familiar }: FamiliarRowProps) => (
  <Item
    size="xs"
    className="gap-2.5 px-2 data-[status=active]:bg-muted"
    render={
      <Link to="/dm/$familiar" params={{ familiar: String(familiar.id) }} />
    }
  >
    <ItemMedia>
      <PixelAvatar familiar={familiar} />
    </ItemMedia>
    <ItemContent className="min-w-0">
      <ItemTitle className="w-full truncate text-sm">{familiar.name}</ItemTitle>
    </ItemContent>
  </Item>
)
