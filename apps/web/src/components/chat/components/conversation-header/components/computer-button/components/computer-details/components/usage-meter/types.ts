import type { Usage } from '@/lib/computers'

export type UsageMeterProps = {
  label: string
  usage: Usage
  /** The amount in words, such as `512 MB of 4 GB`. */
  value: string
}
