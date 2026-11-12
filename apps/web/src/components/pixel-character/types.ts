import type { CSSProperties } from 'react'

export type PixelCharacterProps = {
  /** Its shape: the same seed always draws the same one. */
  shape: number
  /** Its colour, an index into `COLOURS`: the shape's own unless given. */
  colour?: number
  /** Width and height in pixels; whole multiples of 16 keep its pixels whole. */
  size: number
  /** Its Familiar is replying: it bobs. */
  talking?: boolean
  className?: string
  style?: CSSProperties
}
