import { useSyncExternalStore } from 'react'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import type { ConnectionDrawerProps } from './types'

// Tailwind's md breakpoint, where the page puts the list beside the detail.
const phone = window.matchMedia('(width < 48rem)')
const watchPhone = (change: () => void) => {
  phone.addEventListener('change', change)
  return () => phone.removeEventListener('change', change)
}

/**
 * From the side beside the list, or up from the bottom on a phone. Its
 * content mounts each time it opens, so a form inside starts fresh.
 */
export const ConnectionDrawer = ({
  open,
  onClose,
  title,
  description,
  children,
}: ConnectionDrawerProps) => {
  const mobile = useSyncExternalStore(watchPhone, () => phone.matches)

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => !next && onClose()}
      swipeDirection={mobile ? 'down' : 'right'}
    >
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{title}</DrawerTitle>
          <DrawerDescription>{description}</DrawerDescription>
        </DrawerHeader>
        {children}
      </DrawerContent>
    </Drawer>
  )
}
