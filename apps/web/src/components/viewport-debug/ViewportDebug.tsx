import { useEffect, useState } from 'react'
import { useViewportDebug } from '@/lib/viewport-debug'

type Reading = [label: string, value: string]

const px = (value: number) => `${Math.round(value * 10) / 10}px`

/** What the browser resolves `css` to, read from a hidden fixed element. */
function probe(css: string, read: (element: HTMLElement) => string) {
  const element = document.createElement('div')
  element.style.cssText = `position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;${css}`
  document.body.append(element)
  const value = read(element)
  element.remove()
  return value
}

const heightOf = (height: string) =>
  probe(`height:${height}`, (element) =>
    px(element.getBoundingClientRect().height),
  )

const insetOf = (side: string) =>
  probe(
    `padding-top:env(safe-area-inset-${side})`,
    (element) => getComputedStyle(element).paddingTop,
  )

const rectOf = (selector: string) => {
  const rect = document.querySelector(selector)?.getBoundingClientRect()
  return rect ? `${px(rect.top)} → ${px(rect.bottom)}` : 'none'
}

function measure(): Reading[] {
  const visual = window.visualViewport
  return [
    [
      'standalone',
      String(window.matchMedia('(display-mode: standalone)').matches),
    ],
    ...['top', 'right', 'bottom', 'left'].map((side): Reading => [
      `inset ${side}`,
      insetOf(side),
    ]),
    ['100vh', heightOf('100vh')],
    ['100svh', heightOf('100svh')],
    ['100dvh', heightOf('100dvh')],
    ['100lvh', heightOf('100lvh')],
    ['innerHeight', px(window.innerHeight)],
    ['clientHeight', px(document.documentElement.clientHeight)],
    [
      'visualViewport',
      visual ? `${px(visual.height)} @ ${px(visual.offsetTop)}` : 'none',
    ],
    ['screen', `${screen.width}×${screen.height} @${devicePixelRatio}x`],
    ['header', rectOf('header')],
    ['composer', rectOf('form')],
  ]
}

/**
 * An overlay of what this device reports for the viewport and safe areas,
 * with the safe area outlined, for fixing layout on devices we can't inspect.
 */
export const ViewportDebug = () => {
  const on = useViewportDebug((state) => state.on)
  const [readings, setReadings] = useState<Reading[]>([])

  useEffect(() => {
    if (!on) {
      return
    }
    const update = () => setReadings(measure())
    update()
    // Standalone iOS settles its viewport a moment after launch.
    const settled = setTimeout(update, 500)
    window.addEventListener('resize', update)
    window.visualViewport?.addEventListener('resize', update)
    window.visualViewport?.addEventListener('scroll', update)
    return () => {
      clearTimeout(settled)
      window.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('scroll', update)
    }
  }, [on])

  if (!on) {
    return null
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-50">
      <div className="absolute inset-0 border-2 border-sky-500" />
      <div className="absolute top-[env(safe-area-inset-top)] right-[env(safe-area-inset-right)] bottom-[env(safe-area-inset-bottom)] left-[env(safe-area-inset-left)] border-2 border-dashed border-red-500" />
      <dl className="absolute top-1/3 left-1/2 grid -translate-x-1/2 grid-cols-[auto_auto] gap-x-3 bg-black/80 p-3 font-mono text-[11px] text-white">
        {readings.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-white/60">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
