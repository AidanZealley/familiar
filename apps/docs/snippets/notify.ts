import type { Author, Notification, Notify } from '@familiar-ai/core'

/** Your app's own notifications: its members, preferences and delivery. */
export type Notifications = {
  /** Who in this tenant wants reminders, by your app's preferences. */
  recipients: (tenant: string) => Promise<Author[]>
  send: (
    to: Author,
    message: Notification & { requestedBy?: string },
  ) => Promise<void>
}

/**
 * A tenant's `notify`. Familiar says what to show and whose schedule it
 * was; your app chooses who sees it.
 */
export const notifyTenant =
  (tenant: string, app: Notifications): Notify =>
  async (notification, context) => {
    for (const member of await app.recipients(tenant)) {
      await app.send(member, {
        ...notification,
        requestedBy: context?.creator?.name,
      })
    }
  }
