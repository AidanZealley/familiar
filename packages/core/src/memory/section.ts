import { LIMITS, type PageState, type Subject } from './store.ts'

/**
 * The memory section of the chat's prompt, the only memory always in view:
 * the profile of each person who takes part, and a roster of everyone and
 * everything else, most recently changed first, within its budget. It
 * changes only when a profile or the roster does, so the provider's prompt
 * cache holds between.
 */

export const MEMORY_INTRO = `What you know about the people you work with, kept from your conversations. Use it without announcing it. This is only what's worth having in mind always: \`recall\` searches everything else you've been told, including earlier conversations by date, and \`read_memory\` opens a page or a conversation.`

export type SectionSource = {
  subjects(): readonly Subject[]
  page(subject: string): Readonly<PageState> | undefined
}

export function renderSection(
  memory: SectionSource,
  rosterBudget: number = LIMITS.roster,
) {
  const subjects = memory.subjects()
  const people = subjects.filter((subject) => subject.person !== undefined)
  const others = subjects
    .filter((subject) => subject.person === undefined)
    .sort((a, b) => b.changed - a.changed)

  const roster: string[] = []
  let size = 0
  for (const subject of others) {
    const line = `${subject.name} (${subject.id})${subject.line ? `: ${subject.line}` : ''}`
    size += line.length + 1
    if (size > rosterBudget) {
      break
    }
    roster.push(line)
  }
  const left = others.length - roster.length

  return [
    MEMORY_INTRO,
    '',
    'People you work with:',
    ...(people.length
      ? people.map((person) => {
          const profile = memory.page(person.id)?.profile
          return `${person.name} (${person.id})${profile ? `: ${profile}` : ''}`
        })
      : ['(nobody yet)']),
    ...(others.length
      ? [
          '',
          'Others you know about, most recent first:',
          ...roster,
          ...(left ? [`…and ${left} more, which recall finds.`] : []),
        ]
      : []),
  ].join('\n')
}
