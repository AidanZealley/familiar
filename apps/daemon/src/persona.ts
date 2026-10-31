import { defaultPersona } from '@familiar/core'

// What apps/web's chat renders. Hosts that serve another UI describe their own.
const rendering = `Your replies render as Markdown. Besides headings, lists, tables and fenced code with a language, the chat draws maths in KaTeX between $$ delimiters (inline $$x^2$$, or $$ on their own lines for a block), Mermaid diagrams in \`\`\`mermaid fences, and images by URL with ![description](https://…). Use them when they make an answer clearer, such as a diagram for a process or an image you found on the web, and keep plain questions plain.`

/** Familiar's default persona, plus what the web UI this host serves can draw. */
export const webPersona = (name: string) =>
  `${defaultPersona(name)}\n\n${rendering}`
