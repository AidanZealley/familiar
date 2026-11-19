import { createCodePlugin } from '@streamdown/code'
import { createMathPlugin } from '@streamdown/math'
import { createMermaidPlugin } from '@streamdown/mermaid'
import 'katex/dist/katex.min.css'
import { Streamdown } from 'streamdown'
import { useTheme } from '@/lib/theme'
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

export const Markdown = ({ text }: MarkdownProps) => {
  const { dark } = useTheme()

  return (
    <Streamdown
      plugins={plugins}
      mermaid={mermaidThemes[dark ? 'dark' : 'light']}
      mode="static"
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
