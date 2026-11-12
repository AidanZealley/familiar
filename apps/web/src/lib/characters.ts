/**
 * Familiars' generated characters: hand-drawn 16×16 parts that fit every
 * other. A shape seed picks a body, a top feature, eyes and feet or not,
 * so any seed makes a whole character and the same seed always the same
 * one; a colour, one of `COLOURS`, paints it. A seed also suggests a
 * colour, its default. Bodies are mirrored; each says where its eyes go.
 */

/** Each body's left half, row by row from its top, and where its eyes sit. */
const BODIES = [
  { top: 5, rows: [5, 6, 7, 7, 7, 7, 7, 7, 7, 7, 6], eyeY: 8, gap: 2 }, // loaf
  { top: 4, rows: [3, 5, 6, 6, 6, 6, 6, 6, 6, 6, 5, 4], eyeY: 7, gap: 2 }, // bean
  { top: 5, rows: [6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6], eyeY: 8, gap: 2 }, // block
  { top: 4, rows: [2, 3, 4, 4, 5, 5, 6, 6, 7, 7, 7, 6], eyeY: 8, gap: 1 }, // pear
  { top: 6, rows: [4, 6, 7, 7, 7, 7, 7, 7, 6, 5], eyeY: 9, gap: 2 }, // blob
  { top: 4, rows: [3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 3], eyeY: 7, gap: 1 }, // tower
] as const

/** Each top feature's left-half pixels: x from the top row's left edge, y above the top. */
const FEATURES: ((edge: number) => [number, number][])[] = [
  () => [], // none
  (e) => [
    [e, -1],
    [e, -2],
    [e + 1, -1],
  ], // cat ears
  (e) => [
    [e + 1, -1],
    [e + 1, -2],
    [e + 1, -3],
    [e + 2, -1],
    [e + 2, -2],
    [e + 2, -3],
  ], // bunny ears
  (e) => [
    [e, -1],
    [e - 1, -2],
    [e - 1, -3],
  ], // horns
  () => [
    [7, -1],
    [7, -2],
    [6, -3],
    [7, -3],
  ], // antenna
  () => [
    [6, -1],
    [7, -1],
    [7, -2],
  ], // tuft
]

/** Eye cuts, in pixels. */
const EYES = [
  { w: 1, h: 2 }, // dot
  { w: 2, h: 2 }, // block
  { w: 2, h: 3 }, // tall
  { w: 3, h: 2 }, // wide
] as const

/** One lightness and chroma, many hues: a family, in block colour. */
const HUES = [25, 55, 85, 140, 175, 220, 255, 290, 330, 0]
/** Each colour a character can be, by index. */
export const COLOURS = HUES.map((hue) => `oklch(0.72 0.16 ${hue})`)

const HALF = 8

export type Eyes = { w: number; h: number; y: number; gap: number }
export type Character = {
  body: string
  eyes: Eyes
  colour: string
  ink: string
}

/** FNV-1a, so neighbouring seeds land on unrelated parts. */
const hash = (seed: number) => {
  let value = 0x811c9dc5
  for (const char of `kit:${seed}`) {
    value = Math.imul(value ^ char.codePointAt(0)!, 0x01000193)
  }
  return value >>> 0
}

/** The parts a seed picks. The order of the picks is what each seed looks like: keep it. */
const partsOf = (seed: number) => {
  let rest = hash(seed)
  const take = (n: number) => {
    const value = rest % n
    rest = Math.floor(rest / n)
    return value
  }
  return {
    body: BODIES[take(BODIES.length)]!,
    feature: FEATURES[take(FEATURES.length)]!,
    eyes: EYES[take(EYES.length)]!,
    feet: take(2) === 1,
    colour: take(HUES.length),
  }
}

/** The colour a shape seed suggests, as an index into `COLOURS`. */
export const colourOf = (seed: number) => partsOf(seed).colour

/** The character a shape seed makes, in a colour: its own unless given. */
export function characterOf(
  shape: number,
  colour = colourOf(shape),
): Character {
  const { body, feature, eyes, feet } = partsOf(shape)
  const hue = HUES[((colour % HUES.length) + HUES.length) % HUES.length]!

  const cells = new Set<string>()
  const mirror = (x: number, y: number) => {
    if (x >= 0 && x < 16 && y >= 0 && y < 16) {
      cells.add(`${x},${y}`)
      cells.add(`${15 - x},${y}`)
    }
  }
  body.rows.forEach((row, i) => {
    for (let x = HALF - row; x < HALF; x++) {
      mirror(x, body.top + i)
    }
  })
  for (const [x, y] of feature(HALF - body.rows[0])) {
    mirror(x, body.top + y)
  }
  if (feet) {
    cells.delete(`${HALF - 1},15`)
    cells.delete(`${HALF},15`)
  }

  // Wide eyes sit closer, and narrow bodies slim them, keeping a pixel to
  // spare either side for looking around.
  const gap = eyes.w === 3 ? 1 : body.gap
  const room = body.rows[body.eyeY - body.top]! - gap - 2
  return {
    body: [...cells]
      .map((cell) => {
        const [x, y] = cell.split(',')
        return `M${x} ${y}h1v1h-1z`
      })
      .join(''),
    eyes: {
      w: Math.max(1, Math.min(eyes.w, room)),
      h: eyes.h,
      y: body.eyeY,
      gap,
    },
    colour: `oklch(0.72 0.16 ${hue})`,
    ink: `oklch(0.24 0.05 ${hue})`,
  }
}

/**
 * Its eyes, looking `look` (-1 to 1 each way) and `lid` shut (0 to 1): they
 * move a whole pixel at a time, and shut to a line.
 */
export function eyesPath(eyes: Eyes, look = { x: 0, y: 0 }, lid = 0) {
  const lx = Math.round(look.x * 1.4)
  const ly = Math.round(look.y * 1.2)
  const h = lid > 0.5 ? 1 : eyes.h
  const y = eyes.y + ly + (eyes.h - h)
  const left = HALF - eyes.gap - eyes.w + lx
  const right = HALF + eyes.gap + lx
  return `M${left} ${y}h${eyes.w}v${h}h-${eyes.w}z M${right} ${y}h${eyes.w}v${h}h-${eyes.w}z`
}
