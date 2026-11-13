/**
 * For tools around Familiar rather than hosts: offline diagnostics of its
 * stored conversation, and seeding sample memory (the demo, the eval). Not
 * part of the API a host gives people.
 */
export { nextUpkeep, type UpkeepState } from './memory/upkeep/schedule.ts'
export {
  formatMessage,
  MESSAGE_KIND,
  saidBy,
  textOf,
} from './conversation/message.ts'
export { Facts, type Fact } from './memory/facts.ts'
export { Episodes, type Episode } from './memory/episodes.ts'
export {
  createExchangeIndex,
  entryOf,
  transcriptExchanges,
  type Exchange,
} from './memory/exchanges.ts'
export { renderMemorySection } from './memory/extension.ts'
export { datesIn } from './memory/episodes.ts'
export { localDay } from './time.ts'
export {
  familiarDoc,
  Familiars,
  type FamiliarId,
} from './workspace/familiars.ts'
export { RECALL_HEADING, recallNote } from './memory/recall.ts'
