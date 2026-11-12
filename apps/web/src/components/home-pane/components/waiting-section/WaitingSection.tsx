import { WaitingFace } from '../waiting-face'
import type { WaitingSectionProps } from './types'

/** A kind of conversation with something waiting: a heading, as the sidebar's, over their faces in a grid or a list. */
export const WaitingSection = ({
  icon: Icon,
  label,
  rooms,
  familiars,
  layout,
}: WaitingSectionProps) => (
  <section aria-label={label} className="flex flex-col gap-2">
    <h2 className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
      <Icon className="size-3" />
      {label}
    </h2>
    <div
      className={layout === 'grid' ? 'flex flex-wrap gap-2' : 'flex flex-col'}
    >
      {rooms.map((room) => (
        <WaitingFace
          key={room.id}
          room={room}
          familiars={familiars}
          layout={layout === 'grid' ? 'tile' : 'row'}
        />
      ))}
    </div>
  </section>
)
