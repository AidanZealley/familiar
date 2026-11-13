import { MEMORY_INTRO } from './filing/prompts.ts'
import { LIMITS, SELF, type PageState, type Subject } from './store.ts'

/**
 * The memory section of the chat's prompt: the only memory always in view.
 * The Familiar's own profile, the profile of each person who takes part,
 * and a roster of everyone and everything else, most recently changed
 * first, within its budget. It grows with the number of people, not with
 * how long the Familiar has run, and changes only when a profile or the
 * roster does, so the provider's prompt cache holds between.
 */

export type SectionSource = {
  subjects(): readonly Subject[]
  page(subject: string): Readonly<PageState> | undefined
}

export function renderSection(
  memory: SectionSource,
  rosterBudget: number = LIMITS.roster,
) {
  const subjects = memory.subjects()
  const self = memory.page(SELF)?.profile
  const people = subjects.filter(
    (subject) => subject.participant?.kind === 'person',
  )
  const others = subjects
    .filter((subject) => subject.kind !== 'self' && !people.includes(subject))
    .sort((a, b) => b.changed - a.changed)

  const roster: string[] = []
  let size = 0
  for (const subject of others) {
    const line = `${subject.name} (${subject.id})${subject.line ? `: ${subject.line}` : ''}`
    if (size + line.length + 1 > rosterBudget) {
      break
    }
    roster.push(line)
    size += line.length + 1
  }
  const left = others.length - roster.length

  return [
    MEMORY_INTRO,
    '',
    'How you have learned to work:',
    self || '(nothing yet)',
    '',
    'People you work with:',
    ...(people.length
      ? people.map((person) => {
          const profile = memory.page(person.id)?.profile
          // A workspace name can be a placeholder; what they said they're
          // called is an alias.
          const also = person.aliases.length
            ? `, also called ${person.aliases.join(', ')}`
            : ''
          return `${person.name}${also} (${person.id})${profile ? `: ${profile}` : ''}`
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
