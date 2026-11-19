import { createCodePlugin } from '@streamdown/code'
import { createMathPlugin } from '@streamdown/math'
import { createMermaidPlugin } from '@streamdown/mermaid'
import 'katex/dist/katex.min.css'
import { Streamdown, defaultRemarkPlugins, type Components } from 'streamdown'
import { useTheme } from '@/lib/theme'
import { Mention } from '../../../mention'
import { remarkMentions } from './remark-mentions'
import type { MarkdownProps } from './types'
import { LinkConfirmation } from './components/link-confirmation'

// Streamdown renders both Shiki themes and picks with Tailwind's `dark:`
// variant, so code follows the app's `.dark` class like everything else.
const plugins = {
  code: createCodePlugin({ themes: ['github-light', 'github-dark'] }),
  math: createMathPlugin(),
  mermaid: createMermaidPlugin(),
}

// Mermaid bakes its colours into each SVG, so diagrams render again when
// the theme changes.
const mermaidThemes = {
  dark: { config: { theme: 'dark' } },
  light: { config: { theme: 'default' } },
} as const

const components: Components = {
  'familiar-mention': ({ children }) =>
    typeof children === 'string' ? <Mention>{children}</Mention> : null,
}

export const Markdown = ({ text, mentions }: MarkdownProps) => {
  const { dark } = useTheme()

  return (
    <Streamdown
      plugins={plugins}
      mermaid={mermaidThemes[dark ? 'dark' : 'light']}
      mode="static"
      components={components}
      allowedTags={{ 'familiar-mention': [] }}
      remarkPlugins={
        mentions?.length
          ? [...Object.values(defaultRemarkPlugins), [remarkMentions, mentions]]
          : undefined
      }
      // Code blocks keep copy; the download button isn't useful in a chat.
      controls={{ code: { copy: true, download: false }, table: false }}
      lineNumbers={false}
      linkSafety={{
        enabled: true,
        renderModal: (props) => <LinkConfirmation {...props} />,
      }}
      className="min-w-0 text-sm leading-relaxed"
    >
      {text}
    </Streamdown>
  )
}
