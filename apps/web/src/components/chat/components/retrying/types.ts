import type { Retrying } from '@familiar-ai/client'

export type RetryingProps = {
  /** When the model is tried again, and why the last request failed. */
  retrying: Retrying
}
