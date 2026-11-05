import type { Author } from '@familiar-ai/core'
import type { Task } from './board.ts'

/**
 * The demo's one person. Nobody signs in; a real host authenticates each
 * request and takes the person from its session.
 */
export const CURRENT_AUTHOR: Author = { id: 'sam', name: 'Sam' }

const priya: Author = { id: 'priya', name: 'Priya' }
const marcus: Author = { id: 'marcus', name: 'Marcus' }

export const SEED_TASKS: Task[] = [
  { id: 'T-1', title: 'Draft the launch checklist', status: 'todo' },
  {
    id: 'T-2',
    title: 'Review onboarding copy',
    status: 'todo',
    assignee: priya,
  },
  { id: 'T-3', title: 'Fix the signup email link', status: 'todo' },
  {
    id: 'T-4',
    title: 'Update the pricing page',
    status: 'in_progress',
    assignee: marcus,
  },
  {
    id: 'T-5',
    title: 'Plan the beta feedback call',
    status: 'in_progress',
    assignee: CURRENT_AUTHOR,
  },
  {
    id: 'T-6',
    title: 'Set up error monitoring',
    status: 'done',
    assignee: priya,
  },
]
