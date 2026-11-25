import type { Mention as MentionSpan } from '@familiar-ai/client'
import type { ReactNode } from 'react'
import { Mention } from '../mention'

/** The message's text, with the spans it mentions someone in picked out. */
export const withMentions = ({
  text,
  mentions = [],
}: {
  text: string
  mentions?: readonly MentionSpan[]
}) => {
  const parts: ReactNode[] = []
  let at = 0
  for (const mention of mentions.toSorted((a, b) => a.start - b.start)) {
    parts.push(
      text.slice(at, mention.start),
      <Mention key={mention.start}>
        {text.slice(mention.start, mention.end)}
      </Mention>,
    )
    at = mention.end
  }
  return [...parts, text.slice(at)]
}
