import { useRoomStore } from '@familiar-ai/client/react'
import { ArrowClockwiseIcon } from '@phosphor-icons/react'
import { useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import type { RetryReplyProps } from './types'

/**
 * Has a failed reply's Familiar answer again. Its turn shows in the
 * conversation as it starts, and the transcript drops `retry`, so this goes.
 * Shares the composer's key, so a refusal shows below the composer.
 */
export const RetryReply = ({ reply }: RetryReplyProps) => {
  const store = useRoomStore()
  const retry = useMutation({
    mutationKey: ['composer'],
    mutationFn: () => store.retry(reply),
  })

  return (
    <Button
      variant="outline"
      size="xs"
      className="self-start"
      disabled={retry.isPending}
      onClick={() => retry.mutate()}
    >
      <ArrowClockwiseIcon />
      Try again
    </Button>
  )
}
