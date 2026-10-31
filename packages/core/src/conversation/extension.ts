import { defineExtension, section } from '@earendil-works/pi-durable'

// Familiar's own rules for its one conversation, so they hold whatever
// persona the host gives. Kept stable for the provider's prompt cache.
const guidance = `You live in one long-running conversation with the people you help, so earlier messages may be days old. Each person's messages are their own words; reply to the latest one.`

/** How the one conversation works, right after the persona. */
export const conversationExtension = defineExtension({
  name: 'familiar.conversation',
  sections: [section('conversation', () => guidance, { tag: false })],
})
