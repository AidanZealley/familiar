import { XIcon } from '@phosphor-icons/react'
import { cn } from 'cn'
import { HourglassSpinner } from '@/components/hourglass-spinner'
import type { DraftImagesProps } from './types'

/** The draft's images, in a strip above its text, each with a ×. */
export const DraftImages = ({ images, onRemove }: DraftImagesProps) => (
  <ul
    aria-label="Attached images"
    className="flex w-full [scrollbar-width:none] gap-2.5 overflow-x-auto px-3 pt-3 pb-1"
  >
    {images.map(({ url, prepared }, index) => (
      <li key={url} className="relative size-16 shrink-0">
        <img
          src={url}
          alt={`Image ${index + 1}`}
          className={cn(
            'size-full object-cover ring-1 ring-foreground/10',
            !prepared && 'opacity-50',
          )}
        />
        {!prepared && (
          <span className="absolute inset-0 grid place-items-center">
            <HourglassSpinner className="size-4" />
          </span>
        )}
        <button
          type="button"
          aria-label={`Remove image ${index + 1}`}
          onClick={() => onRemove(url)}
          className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center bg-foreground text-background ring-2 ring-background"
        >
          <XIcon className="size-2.5" weight="bold" />
        </button>
      </li>
    ))}
  </ul>
)
