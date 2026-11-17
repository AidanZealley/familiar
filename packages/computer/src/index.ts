// Computers for Familiars: the plugin whose tools reach them and the host
// interface each kind of computer host implements. Docker's is
// `@familiar-ai/computer/docker`; the agent that runs on a computer is
// `@familiar-ai/computer/agent`.
export type { ComputerHost, ComputerStatus } from './host.ts'
export { computer, type ComputerOptions } from './plugin.ts'
