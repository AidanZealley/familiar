// Computers for Familiars: the plugin whose tools reach them and the host
// interface it runs them on. Docker's is `@familiar-ai/computer/docker`.
export type { ComputerHost, ComputerStatus } from './host.ts'
export { computer, type ComputerOptions } from './plugin.ts'
