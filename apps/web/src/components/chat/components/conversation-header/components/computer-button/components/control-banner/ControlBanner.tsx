import { HandPointingIcon } from '@phosphor-icons/react'
import { useQuery } from '@tanstack/react-query'
import { useComputerControl } from '@/lib/computer-control'
import { computerDetailQuery, describeCall } from '@/lib/computers'
import type { ControlBannerProps } from './types'

/** `Opening example.com` as `opening example.com`. */
const lowerFirst = (text: string) =>
  text.charAt(0).toLowerCase() + text.slice(1)

/**
 * While this tab has the Familiar's computer: that the person has control,
 * and what the Familiar waits to do, if anything, once they hand back.
 */
export const ControlBanner = ({ familiar }: ControlBannerProps) => {
  const held = useComputerControl(familiar.id) === 'held'
  const { data: detail } = useQuery({
    ...computerDetailQuery(familiar.id),
  })
  const elsewhere = !held && detail?.control === 'person'
  if (!held && !elsewhere) {
    return null
  }
  const waiting = detail?.doing?.find((call) => call.waiting)

  return (
    <div className="flex items-start gap-2 border border-primary/40 bg-primary/15 px-3 py-2 text-xs">
      <HandPointingIcon className="mt-px size-4 shrink-0 text-primary" />
      <span>
        <b className="font-medium">
          {held ? 'You have control.' : 'Computer in use on another device.'}
        </b>{' '}
        <span className="text-muted-foreground">
          {elsewhere
            ? `${familiar.name} will look again when it is handed back.`
            : waiting
              ? `${familiar.name} paused while ${lowerFirst(describeCall({ ...waiting, waiting: undefined }))}, and will look again when you hand back.`
              : `${familiar.name} will look again when you hand back.`}
        </span>
      </span>
    </div>
  )
}
