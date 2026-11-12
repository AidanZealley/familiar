import {
  CalendarDotsIcon,
  ClockCounterClockwiseIcon,
  ListIcon,
  type Icon,
} from '@phosphor-icons/react'

/** Memory's views, in a Familiar's settings. */
export const memorySections: {
  value: 'facts' | 'history' | 'episodes'
  label: string
  icon: Icon
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
    icon: ClockCounterClockwiseIcon,
    description: 'How facts changed over time.',
  },
  {
    value: 'episodes',
    label: 'Episodes',
    icon: CalendarDotsIcon,
    description: 'What happened, by day, week and month.',
  },
]
