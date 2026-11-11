import { cn } from 'cn'
import { PixelAvatar } from '@/components/pixel-avatar'
import { Button } from '@/components/ui/button'
import { PORTRAITS } from '@/lib/avatars'
import type { AvatarPickerProps } from './types'

const option =
  'size-auto p-1 aria-pressed:bg-muted aria-pressed:ring-2 aria-pressed:ring-primary'

/** Every portrait to choose from, after Automatic: the one the Familiar's ID picks. */
export const AvatarPicker = ({
  familiar,
  value,
  onChange,
}: AvatarPickerProps) => (
  <div
    role="group"
    aria-label="Portraits"
    className="flex max-h-60 flex-wrap gap-1 overflow-y-auto border p-1.5"
  >
    <Button
      type="button"
      variant="ghost"
      aria-pressed={value === null}
      onClick={() => onChange(null)}
      className={cn(option, 'gap-2 pr-2.5')}
    >
      <PixelAvatar familiar={{ ...familiar, avatar: undefined }} />
      <span className="text-xs">Automatic</span>
    </Button>
    {PORTRAITS.map((portrait) => (
      <Button
        key={portrait}
        type="button"
        variant="ghost"
        aria-pressed={value === portrait}
        aria-label={`Portrait ${portrait}`}
        title={portrait}
        onClick={() => onChange(portrait)}
        className={option}
      >
        <PixelAvatar familiar={{ ...familiar, avatar: portrait }} />
      </Button>
    ))}
  </div>
)
