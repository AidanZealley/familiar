import type { AgentState, ConversationView } from '@earendil-works/pi-durable'

/** The conversation's model and reasoning level, as Pi stores them. */
export const agentOf = (view: ConversationView | undefined) =>
  view?.docs['pi.agent'] as AgentState | undefined
