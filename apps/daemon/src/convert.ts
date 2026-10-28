import { Worker } from 'node:worker_threads'
import type { Convert, Page } from '@familiar/plugin-web'

export const TOO_COSTLY = 'This page took too long or too much memory to read.'

export type WorkerConvertOptions = {
  /** How long a conversion may take, the worker's start included. */
  timeoutMs?: number
  /** The worker's heap, beyond which V8 stops it. */
  maxOldGenerationSizeMb?: number
}

/**
 * Converts each page in a fresh worker thread that is stopped past a time or
 * memory limit. Conversion is synchronous, so in the daemon's own thread a
 * hostile page could hold every conversation, and the read's timeout
 * couldn't interrupt it; a worker can always be terminated.
 */
export const workerConvert =
  ({
    timeoutMs = 5_000,
    maxOldGenerationSizeMb = 256,
  }: WorkerConvertOptions = {}): Convert =>
  (html, url) =>
    new Promise<Page>((resolve, reject) => {
      const worker = new Worker(
        new URL('./convert-worker.ts', import.meta.url),
        {
          workerData: { html, url },
          resourceLimits: { maxOldGenerationSizeMb },
        },
      )
      // Whatever ends the worker first settles the promise; the rest are
      // no-ops.
      const fail = () => reject(new Error(TOO_COSTLY))
      const timer = setTimeout(() => {
        fail()
        void worker.terminate()
      }, timeoutMs)
      worker.once('message', (result: { page: Page } | { error: string }) => {
        if ('page' in result) {
          resolve(result.page)
        } else {
          reject(new Error(result.error))
        }
      })
      // Out of memory, or the worker failed to start.
      worker.once('error', fail)
      worker.once('exit', () => {
        clearTimeout(timer)
        fail()
      })
    })
