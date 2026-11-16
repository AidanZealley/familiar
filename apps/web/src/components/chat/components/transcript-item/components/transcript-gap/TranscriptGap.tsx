import { useState } from 'react'
import { useRoomStore } from '@familiar-ai/client/react'
import { Button } from '@/components/ui/button'
import type { TranscriptGapProps } from './types'

export const TranscriptGap = ({ gap }: TranscriptGapProps) => {
  const room = useRoomStore()
  const [status, setStatus] = useState<'idle' | 'loading' | 'failed'>('idle')
  const load = async () => {
    setStatus('loading')
    try {
      await room.loadGap(gap)
      setStatus('idle')
    } catch {
      setStatus('failed')
    }
  }
  return (
    <div className="flex justify-center">
      <Button
        variant="secondary"
        size="sm"
        disabled={status === 'loading'}
        onClick={() => void load()}
      >
        {status === 'loading'
          ? 'Loading messages'
          : status === 'failed'
            ? "Couldn't load messages. Retry"
            : 'Load missing messages'}
      </Button>
    </div>
  )
}
