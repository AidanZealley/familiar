import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { useIsPhone } from '@/lib/media'
import type { ConnectionDrawerProps } from './types'

/**
 * From the side, or up from the bottom on a phone. Its
 * content mounts each time it opens, so a form inside starts fresh.
 */
export const ConnectionDrawer = ({
  open,
  onClose,
  title,
  description,
  children,
}: ConnectionDrawerProps) => {
  const mobile = useIsPhone()

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
