import { WaitingFace } from '../waiting-face'
import type { WaitingSectionProps } from './types'

/**
 * A kind of conversation with something waiting: their faces in a centred
 * grid or a list, under a heading as the sidebar's when it has an icon.
 */
export const WaitingSection = ({
  icon: Icon,
  label,
  rooms,
  familiars,
  layout,
}: WaitingSectionProps) => (
  <section aria-label={label} className="flex flex-col gap-2">
    {Icon && (
      <h2 className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        <Icon className="size-3" />
        {label}
      </h2>
    )}
    <div
      className={
        layout === 'grid'
          ? 'flex flex-wrap justify-center gap-2'
          : 'flex flex-col'
      }
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
