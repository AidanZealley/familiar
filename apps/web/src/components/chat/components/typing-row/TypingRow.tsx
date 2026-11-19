import { cn } from 'cn'
import { HourglassSpinner } from '@/components/hourglass-spinner'
import { PixelAvatar } from '@/components/pixel-avatar'
import { asId, useFamiliars } from '@/lib/workspace'
import type { TypingRowProps } from './types'

const names = new Intl.ListFormat('en', { type: 'conjunction' })

export const TypingRow = ({ replying }: TypingRowProps) => {
  const familiars = useFamiliars()
  if (replying.length === 0) {
    return null
  }

  const members = replying.map(
    ({ familiar }) =>
      familiars.find((member) => member.id === familiar) ?? {
        id: asId(familiar),
        name: 'Removed Familiar',
      },
  )
  const label = names.format(members.map((member) => member.name))

  return (
    <div
      role="status"
      className="mx-4 flex items-center gap-3 bg-background/90 py-2 backdrop-blur-md"
    >
      <span aria-hidden className="flex">
        {members.map((member, index) => (
          <PixelAvatar
            key={member.id}
            familiar={member}
            talking
            className={cn(index > 0 && '-ml-2 border-l-2 border-background')}
          />
        ))}
      </span>
      <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <HourglassSpinner />
        <span className="truncate">
          {label} {members.length === 1 ? 'is' : 'are'} replying…
        </span>
      </span>
    </div>
  )
}
