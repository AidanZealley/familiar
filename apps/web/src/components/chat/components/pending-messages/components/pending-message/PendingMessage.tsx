import { NoteIcon } from '@phosphor-icons/react'
import { HourglassSpinner } from '@/components/hourglass-spinner'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Message, MessageContent } from '@/components/ui/message'
import { DraftImages } from '../../../draft-images'
import { withMentions } from '../../../person-message'
import type { PendingMessageProps } from './types'

/** The hourglass and its label, in place of a sent item's time. */
const Sending = () => (
  <span className="flex items-center gap-1 font-heading text-[0.7rem] text-muted-foreground">
    <HourglassSpinner />
    Sending
  </span>
)

/**
 * A message or note on its way: drawn as it will be once sent, dimmed,
 * with each image's upload as its tile shows it and "Sending" for its time.
 */
export const PendingMessage = ({
  send: { draft, message },
}: PendingMessageProps) =>
  draft.note ? (
    <div aria-label="Note sending" className="flex flex-col items-end gap-1">
      <div className="flex w-full items-start gap-2 border border-dashed bg-muted/40 px-3 py-2 text-xs opacity-60">
        <NoteIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <p className="min-w-0 whitespace-pre-wrap">
          <span className="font-medium">Note</span>
          <br />
          {message.text}
        </p>
      </div>
      <Sending />
    </div>
  ) : (
    <Message align="end" aria-label="Message sending">
      <MessageContent className="items-end gap-1">
        {draft.images.length > 0 && (
          <DraftImages images={draft.images} className="justify-end p-0" />
        )}
        {message.text && (
          <Bubble
            variant="secondary"
            align="end"
            className="max-w-[min(80%,42rem)] opacity-60"
          >
            <BubbleContent className="text-sm whitespace-pre-wrap">
              {withMentions(message)}
            </BubbleContent>
          </Bubble>
        )}
        <Sending />
      </MessageContent>
    </Message>
  )
