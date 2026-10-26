import type { MemoryState } from './memory.ts'

/** Return the unchanged value when the fact is missing. Never mutate the input. */
export function reviseFact(
  memory: MemoryState,
  id: string,
  text: string,
  at: number,
): MemoryState {
  const index = memory.facts.findIndex((fact) => fact.id === id)
  if (index === -1) return memory
  return {
    ...memory,
    facts: memory.facts.map((fact, i) =>
      i === index ? { ...fact, text, at } : fact,
    ),
  }
}

/** Return the unchanged value when the fact is missing. Never mutate the input. */
export function forgetFact(memory: MemoryState, id: string): MemoryState {
  const facts = memory.facts.filter((fact) => fact.id !== id)
  return facts.length === memory.facts.length ? memory : { ...memory, facts }
}
