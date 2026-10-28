import { parentPort, workerData } from 'node:worker_threads'
import { htmlToMarkdown } from '@familiar/plugin-web/markdown'

// One conversion per worker, its result or its error sent back as a message,
// so only running out of time or memory ends the worker any other way.
const { html, url } = workerData as { html: string; url: string }
try {
  parentPort!.postMessage({ page: htmlToMarkdown(html, url) })
} catch (error) {
  parentPort!.postMessage({ error: (error as Error).message })
}
