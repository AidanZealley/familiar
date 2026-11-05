import type { Author } from './conversation/message.ts'

/**
 * Notifications: what Familiar asks its host to show. The host decides who
 * sees each one and how, such as through Web Push or its own system.
 */

/** What a host is asked to show: the same for whoever it shows it to. */
export type Notification = { title: string; body: string; url?: string }

/**
 * Where a scheduled notification came from, for the host to choose its
 * audience and tenant. `creator` is the schedule's stored creator, kept
 * with the schedule so a restart can't lose it; it is attribution, not a
 * recipient. Undefined for schedules made without one, such as before
 * creators were recorded.
 */
export type NotificationContext = {
  scheduleId: string
  creator: Author | undefined
}

/**
 * Delivers a notification. Scheduled runs pass their `context`; plugins'
 * notifications come without one.
 */
export type Notify = (
  notification: Notification,
  context?: NotificationContext,
) => Promise<void>
