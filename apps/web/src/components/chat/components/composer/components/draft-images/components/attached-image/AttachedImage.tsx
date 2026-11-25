import { XIcon } from '@phosphor-icons/react'
import { cn } from 'cn'
import { useLayoutEffect, useRef } from 'react'
import { HourglassSpinner } from '@/components/hourglass-spinner'
import type { AttachedImageProps } from './types'

/**
 * One attached image, with a × if it can be removed: shown from an object
 * URL it holds only while it's on screen, so removing, sending, discarding
 * or leaving frees it. Dimmed with a spinner until prepared.
 */
export const AttachedImage = ({
  image: { file, prepared },
  index,
  onRemove,
}: AttachedImageProps) => {
  const img = useRef<HTMLImageElement>(null)
  useLayoutEffect(() => {
    const url = URL.createObjectURL(file)
    img.current!.src = url
    return () => URL.revokeObjectURL(url)
  }, [file])

  return (
    <li className="relative size-16 shrink-0">
      <img
        ref={img}
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
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove image ${index + 1}`}
          onClick={onRemove}
          className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center bg-foreground text-background ring-2 ring-background"
        >
          <XIcon className="size-2.5" weight="bold" />
        </button>
      )}
    </li>
  )
}
