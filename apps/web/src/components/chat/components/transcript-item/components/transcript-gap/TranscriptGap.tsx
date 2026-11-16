import { useState, useTransition } from 'react'
import { useRoomStore } from '@familiar-ai/client/react'
import { Button } from '@/components/ui/button'
import type { TranscriptGapProps } from './types'

export const TranscriptGap = ({ gap }: TranscriptGapProps) => {
  const room = useRoomStore()
  const [loading, startLoading] = useTransition()
  const [failed, setFailed] = useState(false)
  const load = () =>
    startLoading(async () => {
      try {
        await room.loadGap(gap)
        setFailed(false)
      } catch {
        setFailed(true)
      }
    })
  return (
    <div className="flex justify-center">
      <Button variant="secondary" size="sm" disabled={loading} onClick={load}>
        {loading
          ? 'Loading messages'
          : failed
            ? "Couldn't load messages. Retry"
            : 'Load missing messages'}
      </Button>
    </div>
  )
}
