import { ClockIcon } from '@phosphor-icons/react'
import { PixelAvatar } from '@/components/pixel-avatar'
import { asId, useFamiliars } from '@/lib/workspace'
import type { QueuedMarkProps } from './types'

export const QueuedMark = ({ familiars }: QueuedMarkProps) => {
  const members = useFamiliars()

  return familiars.map((id) => {
    const familiar = members.find((member) => member.id === id) ?? {
      id: asId(id),
      name: 'Removed Familiar',
    }

    return (
      <span
        key={id}
        className="flex items-center gap-1 font-heading text-[0.7rem] whitespace-nowrap text-muted-foreground"
      >
        <ClockIcon aria-hidden className="size-3" />
        Queued for
        <span aria-hidden>
          <PixelAvatar familiar={familiar} crop="quarter" />
        </span>
        {familiar.name}
      </span>
    )
  })
}
