import type { Fact } from '@familiar/client'
import { cn } from 'cn'
import { useState } from 'react'
import {
  CORE_BUDGET,
  coreFacts,
  coreSize,
  factSize,
  reserveFacts,
} from '@/lib/memory'
import type { MemoryOverviewProps } from './types'

const number = new Intl.NumberFormat()

const MONTH = 30 * 24 * 60 * 60 * 1000

// One hue, darkest for what matters most: a pin counts as above importance 5.
const groups = [
  {
    key: 'pinned',
    label: 'Pinned',
    shade: 'bg-primary',
    has: (fact: Fact) => !!fact.pinned,
  },
  ...[5, 4, 3, 2, 1].map((importance, index) => ({
    key: `importance-${importance}`,
    label: `Importance ${importance}`,
    shade: [
      'bg-primary/85',
      'bg-primary/70',
      'bg-primary/55',
      'bg-primary/40',
      'bg-primary/28',
    ][index],
    has: (fact: Fact) => !fact.pinned && fact.importance === importance,
  })),
]

const blocksOf = (facts: Fact[]) =>
  groups
    .map((group) => {
      const members = facts.filter(group.has)
      return {
        ...group,
        facts: members,
        size: members.reduce((sum, fact) => sum + factSize(fact), 0),
      }
    })
    .filter((block) => block.facts.length > 0)

type Block = ReturnType<typeof blocksOf>[number]

/**
 * Both kinds of current memory as two bars of the same shades. Core's bar is
 * measured against its budget; reserve has none, so its bar shows only how
 * it splits by importance. Tap a block to see its facts.
 */
export const MemoryOverview = ({ facts }: MemoryOverviewProps) => {
  const core = coreFacts(facts)
  const reserve = reserveFacts(facts)
  const size = coreSize(facts)
  const coreBlocks = blocksOf(core)
  const reserveBlocks = blocksOf(reserve)
  const reserveSize = reserveBlocks.reduce((sum, block) => sum + block.size, 0)
  // Measured when shown, not live: a fact ageing past 30 days can wait.
  const [now] = useState(Date.now)
  const recent = facts.filter((fact) => now - fact.saved < MONTH).length

  // `core:pinned`, `reserve:importance-2`…: the open block, if any.
  const [selected, setSelected] = useState<string>()
  const toggle = (key: string) =>
    setSelected(key === selected ? undefined : key)
  const open = [
    ...coreBlocks.map((block) => ({
      bar: 'Core',
      id: `core:${block.key}`,
      block,
    })),
    ...reserveBlocks.map((block) => ({
      bar: 'Reserve',
      id: `reserve:${block.key}`,
      block,
    })),
  ].find((entry) => entry.id === selected)

  const bar = (name: 'core' | 'reserve', blocks: Block[], total: number) =>
    blocks.map((block) => (
      <button
        key={block.key}
        type="button"
        title={`${block.label}: ${block.facts.length} facts`}
        aria-label={`${name}, ${block.label}: ${block.facts.length} facts`}
        aria-pressed={`${name}:${block.key}` === selected}
        onClick={() => toggle(`${name}:${block.key}`)}
        style={{ width: `${(block.size / total) * 100}%` }}
        className={cn(
          'min-w-1.5 rounded-[4px] transition-opacity',
          block.shade,
          selected && `${name}:${block.key}` !== selected && 'opacity-25',
        )}
      />
    ))

  return (
    <section className="rounded-xl border bg-card p-4">
      <h2 className="font-heading text-lg font-medium">Memory overview</h2>
      <div className="mt-3 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium">Core</h3>
        <span className="text-xs text-muted-foreground tabular-nums">
          {core.length} facts · {number.format(size)} of{' '}
          {number.format(CORE_BUDGET)} characters
        </span>
      </div>
      <div className="mt-1.5 flex h-5 gap-[2px] rounded-md bg-muted">
        {bar('core', coreBlocks, CORE_BUDGET)}
        <span className="ml-auto self-center pr-2 text-[0.65rem] text-muted-foreground tabular-nums">
          {number.format(Math.max(0, CORE_BUDGET - size))} left
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Read before every reply.
      </p>

      {reserve.length > 0 && (
        <>
          <div className="mt-4 flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-medium">Reserve</h3>
            <span className="text-xs text-muted-foreground tabular-nums">
              {reserve.length} facts
            </span>
          </div>
          <div className="mt-1.5 flex h-5 gap-[2px]">
            {bar('reserve', reserveBlocks, reserveSize)}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Brought into a reply when relevant.
          </p>
        </>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
        {groups.map((group) => (
          <span key={group.key} className="inline-flex items-center gap-1.5">
            <span className={cn('size-2.5 rounded-[3px]', group.shade)} />
            {group.key === 'pinned' ? 'Pinned' : group.label.slice(-1)}
          </span>
        ))}
        <span className="ml-auto">{recent} new in 30 days</span>
      </div>

      {open && (
        <div className="mt-3 text-sm">
          <p className="text-xs text-muted-foreground">
            {open.bar} · {open.block.label} · {open.block.facts.length}{' '}
            {open.block.facts.length === 1 ? 'fact' : 'facts'}
          </p>
          <ul className="mt-1.5 flex flex-col gap-1 border-l pl-3 text-xs">
            {open.block.facts.map((fact) => (
              <li key={fact.id}>{fact.text}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
