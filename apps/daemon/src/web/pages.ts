import Piscina from 'piscina'

// Synchronous HTML conversion must not block the daemon; Piscina owns its limits.
const pages = new Piscina({
  filename: new URL(
    import.meta.url.endsWith('.ts') ? './page-worker.ts' : './page-worker.js',
    import.meta.url,
  ).href,
  minThreads: 0,
  maxThreads: 2,
  maxQueue: 8,
  resourceLimits: { maxOldGenerationSizeMb: 128 },
})

export const toMarkdown = (
  html: string,
  url: string,
  signal: AbortSignal,
): Promise<string> => pages.run({ html, url }, { signal })
