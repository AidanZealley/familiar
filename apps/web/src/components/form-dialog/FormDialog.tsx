import type { FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { useIsPhone } from '@/lib/media'
import type { FormDialogProps } from './types'

/**
 * A short form that makes something, open while it's mounted: a centred dialog, or on
 * a phone a drawer from the bottom, within reach of a thumb.
 */
export const FormDialog = ({
  title,
  description,
  canSubmit,
  onSubmit,
  onClose,
  children,
}: FormDialogProps) => {
  const isPhone = useIsPhone()
  const submit = (event: FormEvent) => {
    event.preventDefault()
    onSubmit()
  }
  const cancel = (
    <Button type="button" variant="outline" onClick={onClose}>
      Cancel
    </Button>
  )
  const create = (
    <Button type="submit" disabled={!canSubmit}>
      Create
    </Button>
  )

  if (isPhone) {
    return (
      <Drawer open showSwipeHandle onOpenChange={(open) => !open && onClose()}>
        <DrawerContent>
          <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
            <DrawerHeader>
              <DrawerTitle>{title}</DrawerTitle>
              <DrawerDescription>{description}</DrawerDescription>
            </DrawerHeader>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
            <DrawerFooter className="pb-[max(1rem,env(safe-area-inset-bottom))]">
              {create}
              {cancel}
            </DrawerFooter>
          </form>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(var(--app-height)-2rem)] overflow-y-auto sm:max-w-md">
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {children}
          <DialogFooter>
            {cancel}
            {create}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
