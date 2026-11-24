import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { XIcon } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from '@/components/ui/dialog'
import type { ImageViewerProps } from './types'

/**
 * An image full size on a dark backdrop, until closed: by its ×, Escape, or
 * a click anywhere.
 */
export const ImageViewer = ({ source, open, onClose }: ImageViewerProps) => (
  <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
    <DialogPortal>
      {/* Each fade out holds at nothing once it ends: Base UI removes them a
          frame or two later, and until then they'd snap back to full,
          flashing the dark backdrop over the whole app. */}
      <DialogOverlay className="bg-black/85 data-closed:fill-mode-forwards" />
      <DialogPrimitive.Popup
        className="fixed inset-0 z-50 grid place-items-center p-4 outline-none data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 data-closed:fill-mode-forwards"
        onClick={onClose}
      >
        <DialogTitle className="sr-only">Image</DialogTitle>
        {source && (
          <img
            src={source}
            alt=""
            className="max-h-full max-w-full object-contain"
          />
        )}
        <DialogClose
          render={
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-[max(0.75rem,env(safe-area-inset-top))] right-3 text-white hover:bg-white/10 hover:text-white"
            />
          }
        >
          <XIcon />
          <span className="sr-only">Close</span>
        </DialogClose>
      </DialogPrimitive.Popup>
    </DialogPortal>
  </Dialog>
)
