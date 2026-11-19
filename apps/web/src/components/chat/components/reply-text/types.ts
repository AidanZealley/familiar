import type { Mention } from '@familiar-ai/client'

export type ReplyTextProps = {
  text: string
  mentions?: readonly Mention[]
}
