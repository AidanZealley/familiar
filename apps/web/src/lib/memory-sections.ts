import {
  CalendarDaysIcon,
  HistoryIcon,
  ListIcon,
  type LucideIcon,
} from 'lucide-react'

/** The Memory pages, for every nav that links to them. */
export const memorySections: {
  to: '/memory' | '/memory/history' | '/memory/episodes'
  label: string
  icon: LucideIcon
  description: string
}[] = [
  {
    to: '/memory',
    label: 'Facts',
    icon: ListIcon,
    description: 'What Familiar knows now: pinned, core and reserve.',
  },
  {
    to: '/memory/history',
    label: 'History',
    icon: HistoryIcon,
    description: 'How facts changed over time.',
  },
  {
    to: '/memory/episodes',
    label: 'Episodes',
    icon: CalendarDaysIcon,
    description: 'What happened, by day, week and month.',
  },
]
