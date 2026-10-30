import { createCodePlugin } from '@streamdown/code'
import { createMathPlugin } from '@streamdown/math'
import { createMermaidPlugin } from '@streamdown/mermaid'
import 'katex/dist/katex.min.css'
import { useSyncExternalStore } from 'react'
import { Streamdown } from 'streamdown'
import type { MarkdownProps } from './types'

// Streamdown renders both Shiki themes and picks with Tailwind's `dark:`
// variant, so code follows the app's `.dark` class like everything else.
const plugins = {
  code: createCodePlugin({ themes: ['github-light', 'github-dark'] }),
  math: createMathPlugin(),
  mermaid: createMermaidPlugin(),
}

// Mermaid bakes its colours into each SVG, so diagrams follow the `.dark`
// class by rendering again when it changes.
const root = document.documentElement
const subscribe = (onChange: () => void) => {
  const observer = new MutationObserver(onChange)
  observer.observe(root, { attributeFilter: ['class'] })
  return () => observer.disconnect()
}
const mermaidThemes = {
  dark: { config: { theme: 'dark' } },
  light: { config: { theme: 'default' } },
} as const

export const Markdown = ({ text, streaming }: MarkdownProps) => {
  const dark = useSyncExternalStore(subscribe, () =>
    root.classList.contains('dark'),
  )

  return (
    <Streamdown
      plugins={plugins}
      mermaid={mermaidThemes[dark ? 'dark' : 'light']}
      isAnimating={streaming}
      // Soften token batches without building a noticeable reveal backlog.
      animated={{
        animation: 'fadeIn',
        duration: 200,
        easing: 'ease-out',
        sep: 'word',
        stagger: 12,
        maxBacklogMs: 120,
      }}
      // Code blocks keep copy; the download button isn't useful in a chat.
      controls={{ code: { copy: true, download: false }, table: false }}
      lineNumbers={false}
      className="min-w-0 text-sm leading-relaxed"
    >
      {text}
    </Streamdown>
  )
}
