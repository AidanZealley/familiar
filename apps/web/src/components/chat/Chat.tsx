import { toTranscript } from '@familiar/client'
import { useEffect, useMemo, useRef } from 'react'
import { useFamiliar } from '@/lib/familiar'
import { Composer } from './components/composer'
import { TranscriptItem } from './components/transcript-item'

export const Chat = () => {
  const view = useFamiliar((state) => state.view)
  const connection = useFamiliar((state) => state.connection)
  const transcript = useMemo(() => view && toTranscript(view), [view])
  const end = useStickToBottom(transcript)

  return (
    <div className="mx-auto flex h-svh max-w-3xl flex-col">
      <header className="flex items-center justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-3">
        <h1 className="font-medium">Familiar</h1>
        {connection !== 'open' && (
          <span className="text-xs text-muted-foreground">
            {connection === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
          </span>
        )}
      </header>

      <main className="flex-1 overflow-y-auto px-4">
        <div className="flex flex-col gap-4 py-4">
          {transcript?.items.map((item) => (
            <TranscriptItem key={item.id} item={item} />
          ))}
          <div ref={end} />
        </div>
      </main>

      <Composer busy={transcript?.busy ?? false} />
    </div>
  )
}

/** Keep the newest item in view while the reader is already at the bottom. */
function useStickToBottom(dependency: unknown) {
  const end = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)

  useEffect(() => {
    const target = end.current
    if (!target) return
    const observer = new IntersectionObserver(([entry]) => {
      atBottom.current = entry.isIntersecting
    })
    observer.observe(target)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (atBottom.current) end.current?.scrollIntoView({ block: 'end' })
  }, [dependency])

  return end
}
