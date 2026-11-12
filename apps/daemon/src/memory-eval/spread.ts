/**
 * What a measure came to across repeated runs: its mean and the range the
 * runs fell in. A move smaller than the range isn't evidence of anything.
 */
export type Spread = { mean: number; min: number; max: number }

const round = (value: number) => Math.round(value * 1000) / 1000

/** The mean, smallest and largest of `values`; all zero when there are none. */
export function spreadOf(values: number[]): Spread {
  if (!values.length) {
    return { mean: 0, min: 0, max: 0 }
  }
  return {
    mean: round(values.reduce((sum, value) => sum + value, 0) / values.length),
    min: round(Math.min(...values)),
    max: round(Math.max(...values)),
  }
}

/** `64% (60–70%)`: a share's mean, then its range. */
export const showShare = ({ mean, min, max }: Spread) =>
  `${Math.round(mean * 100)}% (${Math.round(min * 100)}–${Math.round(max * 100)}%)`

/** `5.2 (4.9–5.6)`: a count or ratio's mean, then its range. */
export const showNumber = ({ mean, min, max }: Spread, digits = 0) =>
  `${mean.toFixed(digits)} (${min.toFixed(digits)}–${max.toFixed(digits)})`
