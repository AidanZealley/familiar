import { Worker } from 'node:worker_threads'
import type { Convert, ConvertOptions, Page } from '@familiar/plugin-web'

export const TOO_COSTLY = 'This page took too long or too much memory to read.'
export const TOO_BUSY =
  'Too many pages are being read at once. Read fewer pages at a time.'

/** One conversion, settling only once whatever ran it has stopped. */
export type Run = (
  html: string,
  url: string,
  options: ConvertOptions,
) => Promise<Page>

export type WorkerOptions = {
  /** How long a conversion may take, the worker's start included. */
  timeoutMs?: number
  /** The worker's heap, beyond which V8 stops it. */
  maxOldGenerationSizeMb?: number
}

/**
 * Runs each conversion in a fresh worker thread, stopped past a time or
 * memory limit. Conversion is synchronous, so in the daemon's own thread a
 * hostile page could hold every conversation, and the read's timeout
 * couldn't interrupt it; a worker can always be terminated. Settles when the
 * thread has exited, so its heap is gone by then.
 */
export const runInWorker =
  ({
    timeoutMs = 5_000,
    maxOldGenerationSizeMb = 256,
  }: WorkerOptions = {}): Run =>
  (html, url, options) =>
    new Promise<Page>((resolve, reject) => {
      const worker = new Worker(
        new URL('./convert-worker.ts', import.meta.url),
        {
          workerData: { html, url, options },
          resourceLimits: { maxOldGenerationSizeMb },
        },
      )
      // Out of time, out of memory, or failed to start, unless it answered.
      let result: { page: Page } | { error: string } = { error: TOO_COSTLY }
      const timer = setTimeout(() => void worker.terminate(), timeoutMs)
      worker.once('message', (message: typeof result) => {
        result = message
      })
      worker.once('exit', () => {
        clearTimeout(timer)
        if ('page' in result) {
          resolve(result.page)
        } else {
          reject(new Error(result.error))
        }
      })
      // Ends the worker, which then exits; without a listener it would throw.
      worker.on('error', () => {})
    })

export type ConverterOptions = {
  run?: Run
  /** How many conversions may run at once. */
  concurrency?: number
  /** How many may wait to run; any more are refused. */
  queue?: number
}

/**
 * The daemon's converter. A model can fetch many pages in one round, and Pi
 * runs them in parallel, so this owns how many run: `concurrency` at once,
 * each holding its place until `run` settles, and `queue` waiting.
 */
export function createConverter({
  run = runInWorker(),
  concurrency = 2,
  queue = 8,
}: ConverterOptions = {}): Convert {
  let running = 0
  const waiting: (() => void)[] = []

  return async (html, url, options) => {
    if (running < concurrency) {
      running++
    } else if (waiting.length < queue) {
      // The place passes straight from the conversion that frees it.
      await new Promise<void>((resolve) => waiting.push(resolve))
    } else {
      throw new Error(TOO_BUSY)
    }
    try {
      return await run(html, url, options)
    } finally {
      const next = waiting.shift()
      if (next) {
        next()
      } else {
        running--
      }
    }
  }
}
