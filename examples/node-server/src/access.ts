import type { Allow, Operation } from '@familiar-ai/core/http'

/**
 * What the owner may do through the API. A list, so an operation Familiar
 * adds later is refused until it's added here. This server has no account
 * sign-in, push or MCP, so those stay off.
 */
const OWNER = new Set<Operation>([
  'familiars.list',
  'familiars.dm',
  'rooms.list',
  'rooms.post',
  'rooms.history',
  'rooms.stop',
  'model.options',
  'model.set',
  'model.setThinkingLevel',
  'memory.revise',
  'memory.retire',
  'memory.setPinned',
  'schedules.cancel',
  'connections.list',
  'connections.setSecret',
  'connections.deleteSecret',
  'events.familiars',
  'events.rooms',
  'events.room',
  'events.model',
  'events.memory',
  'events.episodes',
  'events.schedules',
])

// Everyone authenticate() accepts is the owner.
export const allow: Allow = (_author, operation) => OWNER.has(operation)
