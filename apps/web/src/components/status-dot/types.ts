/** Good, working, needs a look, failed, or off. */
export type Tone = 'ok' | 'busy' | 'warn' | 'bad' | 'off'

export type StatusDotProps = { tone: Tone; className?: string }
