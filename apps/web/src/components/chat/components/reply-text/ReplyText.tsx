import { lazy, Suspense } from 'react'
import type { ReplyTextProps } from './types'

// Streamdown and Shiki are most of the app's code, so they load in their own
// chunk. The import starts with this module rather than at first render, so
// it is usually ready by the time a reply needs it.
const markdown = import('./components/markdown')
const Markdown = lazy(() =>
  markdown.then((module) => ({ default: module.Markdown })),
)

export const ReplyText = (props: ReplyTextProps) => (
  <Suspense
    // Until then, the text as written: readable, and close to its final shape.
    fallback={
      <p className="min-w-0 text-sm leading-relaxed whitespace-pre-wrap">
        {props.text}
      </p>
    }
  >
    <Markdown {...props} />
  </Suspense>
)
