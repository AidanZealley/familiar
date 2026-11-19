import {
  ArrowCounterClockwiseIcon,
  PauseIcon,
  PlayIcon,
} from '@phosphor-icons/react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { asId, useFamiliars } from '@/lib/workspace'
import { PrototypeRoom } from './components/prototype-room'
import type {
  QueuedVariant,
  ReplyingVariant,
} from './components/prototype-room/types'
import { frameAt, STEPS, type Member } from './timeline'

const TICK = 700
// Held on the last step for a moment before it starts again.
const HOLD = 5

const REPLYING: Record<ReplyingVariant, { title: string; about: string }> = {
  A: {
    title: 'A · Typing row',
    about:
      'One row above the composer: talking portraits of everyone replying, with the hourglass. Replies appear whole when they land.',
  },
  B: {
    title: 'B · Live bubbles',
    about:
      'Each reply streams in its own column, with its thinking and tool rows, side by side (stacked on a phone). Each joins the transcript when it lands.',
  },
  C: {
    title: 'C · Header faces',
    about:
      'Portraits in the room header talk while their Familiar replies. The transcript shows nothing until a reply lands.',
  },
}

const QUEUED: Record<QueuedVariant, { title: string; about: string }> = {
  A: {
    title: 'A · Dimmed portrait',
    about:
      'The busy Familiar sits dimmed in the typing row. Hover it to see which room it’s in.',
  },
  B: {
    title: 'B · Queued mark',
    about:
      'A small “Queued for …” mark under your message until the Familiar’s run picks it up.',
  },
}

// Stand-ins when the demo workspace has fewer than three Familiars.
const STAND_INS = ['Wren', 'Kit', 'Moss'].map((name, index) => ({
  id: asId(9000 + index),
  name,
}))

/**
 * Stage 3 of natural rooms, as variants to choose from: how a room shows
 * several Familiars replying at once, and a Familiar busy in another room.
 * Fixture data only, played step by step; nothing reaches the daemon.
 */
export const NaturalRoomsPrototype = () => {
  const familiars = useFamiliars()
  const members = useMemo<Member[]>(
    () => [...familiars, ...STAND_INS].slice(0, 3),
    [familiars],
  )
  const [now] = useState(Date.now)
  const [replying, setReplying] = useState<ReplyingVariant | 'all'>('A')
  const [queued, setQueued] = useState<QueuedVariant>('A')
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(true)

  useEffect(() => {
    if (!playing) {
      return
    }
    const timer = setInterval(
      () => setStep((current) => (current + 1) % (STEPS + HOLD)),
      TICK,
    )
    return () => clearInterval(timer)
  }, [playing])

  const shown = Math.min(step, STEPS - 1)
  const frame = useMemo(
    () => frameAt(shown, members, now),
    [shown, members, now],
  )
  const variants: ReplyingVariant[] =
    replying === 'all' ? ['A', 'B', 'C'] : [replying]

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 md:p-6">
        <header className="flex flex-col gap-1">
          <p className="font-heading text-xs text-muted-foreground">
            Prototype · natural rooms, stage 3
          </p>
          <h1 className="font-heading text-lg font-medium">
            Several Familiars replying at once
          </h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            You ask a question that mentions no one. {members[0]?.name} replies
            at once, {members[1]?.name} is busy in Workshop first, then recalls
            something and replies, and {members[2]?.name} thinks, then stays
            quiet, which posts nothing.
          </p>
        </header>

        <div className="flex flex-col gap-4 md:flex-row md:flex-wrap md:items-start md:gap-8">
          <div className="flex flex-col gap-2">
            <span className="font-heading text-xs font-medium">
              Replying at once
            </span>
            <Tabs
              value={replying}
              onValueChange={(value) => setReplying(value)}
            >
              <TabsList>
                <TabsTrigger value="A">A</TabsTrigger>
                <TabsTrigger value="B">B</TabsTrigger>
                <TabsTrigger value="C">C</TabsTrigger>
                <TabsTrigger value="all">All</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="flex flex-col gap-2">
            <span className="font-heading text-xs font-medium">
              Busy in another room
            </span>
            <Tabs value={queued} onValueChange={(value) => setQueued(value)}>
              <TabsList>
                <TabsTrigger value="A">A</TabsTrigger>
                <TabsTrigger value="B">B</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="flex flex-col gap-2">
            <span className="font-heading text-xs font-medium">Playback</span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                aria-label={playing ? 'Pause' : 'Play'}
                onClick={() => setPlaying(!playing)}
              >
                {playing ? <PauseIcon /> : <PlayIcon />}
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Start again"
                onClick={() => setStep(0)}
              >
                <ArrowCounterClockwiseIcon />
              </Button>
              <input
                type="range"
                min={0}
                max={STEPS - 1}
                value={shown}
                aria-label="Step"
                onChange={(event) => {
                  setPlaying(false)
                  setStep(Number(event.target.value))
                }}
                className="w-40 accent-primary"
              />
              <span className="font-heading text-xs text-muted-foreground tabular-nums">
                {shown + 1}/{STEPS}
              </span>
            </div>
          </div>
        </div>

        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {variants.map((variant) => (
            <div key={variant}>
              <dt className="font-heading text-xs font-medium">
                Replying {REPLYING[variant].title}
              </dt>
              <dd className="text-muted-foreground">
                {REPLYING[variant].about}
              </dd>
            </div>
          ))}
          <div>
            <dt className="font-heading text-xs font-medium">
              Busy elsewhere {QUEUED[queued].title}
            </dt>
            <dd className="text-muted-foreground">{QUEUED[queued].about}</dd>
          </div>
        </dl>

        <div
          className={
            variants.length > 1 ? 'grid gap-4 lg:grid-cols-3' : 'max-w-3xl'
          }
        >
          {variants.map((variant) => (
            <PrototypeRoom
              key={variant}
              frame={frame}
              members={members}
              replying={variant}
              queued={queued}
              caption={
                variants.length > 1 ? REPLYING[variant].title : undefined
              }
            />
          ))}
        </div>
      </div>
    </div>
  )
}
