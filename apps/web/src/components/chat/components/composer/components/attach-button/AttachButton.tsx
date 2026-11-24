import { CameraIcon, ImagesIcon, PaperclipIcon } from '@phosphor-icons/react'
import { useRef, useState, type ChangeEvent } from 'react'
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import { InputGroupButton } from '@/components/ui/input-group'
import { useIsTouch } from '@/lib/media'
import type { AttachButtonProps } from './types'

const pickerClass =
  'flex h-12 w-full items-center gap-3 px-4 text-sm hover:bg-muted active:bg-muted'

/**
 * Attaches images. On a desktop it opens the file dialog. On a touch screen
 * it opens a drawer first: the device's own picker menu then opens beside
 * the drawer's option, already settled, rather than beside a composer the
 * closing keyboard is about to move. The drawer can also open the camera.
 */
export const AttachButton = ({ onAttach }: AttachButtonProps) => {
  const touch = useIsTouch()
  const [open, setOpen] = useState(false)
  const dialog = useRef<HTMLInputElement>(null)

  const picked = (event: ChangeEvent<HTMLInputElement>) => {
    onAttach([...(event.target.files ?? [])])
    // So picking the same image again still counts as a change.
    event.target.value = ''
    setOpen(false)
  }

  return (
    <>
      <InputGroupButton
        size="icon-sm"
        className="size-8"
        aria-label="Attach images"
        title="Attach images"
        onClick={() => (touch ? setOpen(true) : dialog.current?.click())}
      >
        <PaperclipIcon />
      </InputGroupButton>
      {touch ? (
        <Drawer open={open} onOpenChange={setOpen} showSwipeHandle>
          <DrawerContent className="pb-[env(safe-area-inset-bottom)]">
            <DrawerTitle className="sr-only">Attach images</DrawerTitle>
            {/* Labels open their inputs natively, beside the option tapped. */}
            <label className={pickerClass}>
              <CameraIcon className="size-5" />
              Camera
              <input
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                onChange={picked}
              />
            </label>
            <label className={pickerClass}>
              <ImagesIcon className="size-5" />
              Photos and files
              <input
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={picked}
              />
            </label>
          </DrawerContent>
        </Drawer>
      ) : (
        <input
          ref={dialog}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={picked}
        />
      )}
    </>
  )
}
