import {
  CalendarDaysIcon,
  HistoryIcon,
  ListIcon,
  type LucideIcon,
} from 'lucide-react'

/** Memory's views, in a Familiar's settings. */
export const memorySections: {
  value: 'facts' | 'history' | 'episodes'
  label: string
  icon: LucideIcon
  description: string
}[] = [
  {
    value: 'facts',
    label: 'Facts',
    icon: ListIcon,
    description: 'What it knows now: pinned, core and reserve.',
  },
  {
    value: 'history',
    label: 'History',
    icon: HistoryIcon,
    description: 'How facts changed over time.',
  },
  {
    value: 'episodes',
    label: 'Episodes',
    icon: CalendarDaysIcon,
    description: 'What happened, by day, week and month.',
  },
]
