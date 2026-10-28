import { parentPort, workerData } from 'node:worker_threads'
import {
  htmlToMarkdown,
  type ConvertOptions,
} from '@familiar/plugin-web/markdown'

// One conversion per worker, its result or its error sent back as a message,
// so only running out of time or memory ends the worker any other way. The
// page is cut here, so no more than was asked for crosses back.
const { html, url, options } = workerData as {
  html: string
  url: string
  options: ConvertOptions
}
try {
  parentPort!.postMessage({ page: htmlToMarkdown(html, url, options) })
} catch (error) {
  parentPort!.postMessage({ error: (error as Error).message })
}
