import { WarningCircleIcon, XIcon } from '@phosphor-icons/react'
import { cn } from 'cn'
import { useLayoutEffect, useRef } from 'react'
import { useStore } from 'zustand'
import { HourglassSpinner } from '@/components/hourglass-spinner'
import { outbox, type UploadState } from '@/lib/outbox'
import type { AttachedImageProps } from './types'

/** What a tile's upload is doing, in a few words: too small a tile to show them. */
const labelOf = (upload: UploadState | undefined) => {
  switch (upload?.status) {
    case 'uploading':
      return `Uploading ${Math.floor((100 * upload.loaded) / (upload.total || 1))}%`
    case 'preparing':
      return 'Preparing'
    case 'failed':
      return 'Upload failed, tap to retry'
    default:
      return undefined
  }
}

/**
 * One attached image, with how far its upload has got and a × if it can
 * be removed: dimmed with a bar along its foot while uploading, a spinner
 * while the daemon prepares it, and a warning once it has failed, when a
 * tap tries again. Shown from an object URL it holds only while it's on
 * screen, so removing, sending, discarding or leaving frees it.
 */
export const AttachedImage = ({
  image: { id, file },
  index,
  onRetry,
  onRemove,
}: AttachedImageProps) => {
  const img = useRef<HTMLImageElement>(null)
  const upload = useStore(outbox, (state) => state.uploads.get(id))
  useLayoutEffect(() => {
    const url = URL.createObjectURL(file)
    img.current!.src = url
    return () => URL.revokeObjectURL(url)
  }, [file])
  const label = labelOf(upload)
  const failed = upload?.status === 'failed'

  return (
    <li
      className="relative size-16 shrink-0"
      title={label}
      aria-label={label ? `Image ${index + 1}, ${label}` : undefined}
    >
      <img
        ref={img}
        alt={`Image ${index + 1}`}
        className={cn(
          'size-full object-cover ring-1 ring-foreground/10',
          upload?.status !== 'ready' && 'opacity-50',
        )}
      />
      {upload?.status === 'uploading' && (
        <span
          className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-foreground transition-transform"
          style={{
            transform: `scaleX(${upload.loaded / (upload.total || 1)})`,
          }}
        />
      )}
      {upload?.status === 'preparing' && (
        <span className="absolute inset-0 grid place-items-center">
          <HourglassSpinner className="size-4" />
        </span>
      )}
      {failed && (
        <button
          type="button"
          aria-label={`Retry image ${index + 1}`}
          disabled={!onRetry}
          onClick={onRetry}
          className="absolute inset-0 grid place-items-center text-destructive"
        >
          <WarningCircleIcon className="size-5" weight="fill" />
        </button>
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
