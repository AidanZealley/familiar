import { createCodePlugin } from '@streamdown/code'
import { Streamdown } from 'streamdown'
import type { ReplyTextProps } from './types'

// Streamdown renders both Shiki themes and picks with Tailwind's `dark:`
// variant, so code follows the app's `.dark` class like everything else.
const plugins = {
  code: createCodePlugin({ themes: ['github-light', 'github-dark'] }),
}

export const ReplyText = ({ text, streaming }: ReplyTextProps) => (
  <Streamdown
    plugins={plugins}
    isAnimating={streaming}
    // Code blocks keep copy; the download button isn't useful in a chat.
    controls={{ code: { copy: true, download: false }, table: false }}
    lineNumbers={false}
    className="min-w-0 text-sm leading-relaxed"
  >
    {text}
  </Streamdown>
)
