import { PixelAvatar } from '@/components/pixel-avatar'
import { Button } from '@/components/ui/button'
import type { PortraitOptionProps } from './types'

/** One portrait to choose, as it would look, pressed while it's the draft's. */
export const PortraitOption = ({
  familiar,
  avatar,
  selected,
  onSelect,
  name,
}: PortraitOptionProps) => (
  <Button
    type="button"
    variant="ghost"
    aria-pressed={selected}
    aria-label={name}
    title={name}
    onClick={onSelect}
    className="size-auto p-1 aria-pressed:bg-muted aria-pressed:ring-2 aria-pressed:ring-foreground"
  >
    <PixelAvatar familiar={{ ...familiar, avatar: avatar ?? undefined }} />
  </Button>
)
