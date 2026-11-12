import { useEffect, useMemo, useRef } from 'react'
import { characterOf, eyesPath } from '@/lib/characters'
import { watch } from './motion'
import type { PixelCharacterProps } from './types'

/**
 * A generated pixel character. React draws it; the shared loop in
 * `motion.ts` moves only its eyes and, while it replies, its bob.
 */
export const PixelCharacter = ({
  shape,
  colour,
  size,
  talking = false,
  className,
  style,
}: PixelCharacterProps) => {
  const character = useMemo(() => characterOf(shape, colour), [shape, colour])
  const svg = useRef<SVGSVGElement>(null)
  const figure = useRef<SVGGElement>(null)
  const eyes = useRef<SVGPathElement>(null)
  const isTalking = useRef(talking)

  useEffect(() => {
    isTalking.current = talking
  }, [talking])

  useEffect(
    () =>
      watch({
        element: svg.current!,
        talking: () => isTalking.current,
        draw: (look, lid, bob) => {
          eyes.current?.setAttribute('d', eyesPath(character.eyes, look, lid))
          figure.current?.setAttribute(
            'transform',
            `translate(0 ${bob > 0.3 ? -1 : 0})`,
          )
        },
      }),
    [character],
  )

  return (
    <svg
      ref={svg}
      aria-hidden
      viewBox="0 0 16 16"
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className={className}
      // Inline, so a parent's icon sizing, such as Button's, can't shrink it.
      style={{ display: 'block', width: size, height: size, ...style }}
    >
      <g ref={figure}>
        <path fill={character.colour} d={character.body} />
        <path ref={eyes} fill={character.ink} d={eyesPath(character.eyes)} />
      </g>
    </svg>
  )
}
