import type { Usage } from '@familiar-ai/computer'

export type UsageMeterProps = {
  label: string
  usage: Usage
  /** The amount in words, such as `512 MB of 4 GB`. */
  value: string
}
