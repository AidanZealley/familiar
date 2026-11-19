import type { Mention } from '@familiar-ai/client'

type MarkdownNode = {
  type: string
  value?: string
  children?: MarkdownNode[]
  position?: {
    start: { offset?: number }
    end: { offset?: number }
  }
  data?: { hName: string }
}

export const remarkMentions =
  (mentions: readonly Mention[]) =>
  (tree: MarkdownNode, file: { value: unknown }) => {
    const source = String(file.value)
    const ends = new Map(mentions.map(({ start, end }) => [start, end]))

    const replace = (node: MarkdownNode): MarkdownNode[] => {
      const start = node.position?.start.offset
      const end = node.position?.end.offset
      if (node.type !== 'text' || start === undefined || end === undefined) {
        if (node.children) {
          node.children = node.children.flatMap(replace)
        }
        return [node]
      }

      const token = /(@\[[^[\]\r\n]+\])/gu
      const raw = [...source.slice(start, end).matchAll(token)]
      const parts = (node.value ?? '').split(token)
      // Markdown can decode escapes or entities. Pair source offsets with
      // rendered tokens only when both lists agree.
      if (
        parts.length !== raw.length * 2 + 1 ||
        raw.some(([label], index) => label !== parts[index * 2 + 1])
      ) {
        return [node]
      }

      const highlighted = raw.map(({ 0: label, index }) => {
        const offset = start + index
        return ends.get(offset) === offset + label.length
      })
      if (!highlighted.some(Boolean)) {
        return [node]
      }

      return parts.map((value, index) =>
        index % 2 === 1 && highlighted[(index - 1) / 2]
          ? {
              type: 'emphasis',
              data: { hName: 'familiar-mention' },
              children: [{ type: 'text', value: '@' + value.slice(2, -1) }],
            }
          : { type: 'text', value },
      )
    }

    replace(tree)
  }
