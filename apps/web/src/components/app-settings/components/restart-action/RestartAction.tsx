import { useState } from 'react'
import { RestartDialog } from '@/components/restart-dialog'
import type { RestartActionProps } from './types'

/** Settings' Restart action: restarts Familiar's service once confirmed. */
export const RestartAction = ({ link, info }: RestartActionProps) => {
  const [open, setOpen] = useState(false)
  return (
    <RestartDialog
      open={open}
      onOpenChange={setOpen}
      info={info}
      trigger={link}
      description="It stops for a moment and starts again, picking up provider keys and plugins changed since it started."
    />
  )
}
