import { ArrowClockwiseIcon } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker'
import type { RetryingProps } from './types'

/** A model request that failed, counting down to its next try. */
export const Retrying = ({ retrying }: RetryingProps) => {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const seconds = Math.ceil((retrying.at - now) / 1000)

  return (
    <Marker role="status" className="text-muted-foreground">
      <MarkerIcon>
        <ArrowClockwiseIcon />
      </MarkerIcon>
      <MarkerContent className="line-clamp-2">
        {seconds > 0 ? `Retrying in ${seconds}s` : 'Retrying'}: {retrying.error}
      </MarkerContent>
    </Marker>
  )
}
