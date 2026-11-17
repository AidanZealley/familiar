// The host's side of computers: which Familiars have one, the plugin whose
// tools reach it, and the routes that pair one. The agent that runs on the
// computer is `@familiar-ai/computer/agent`.
export {
  openComputers,
  type Computers,
  type ComputersOptions,
  type ComputerStatus,
} from './host/computers.ts'
export { COMPUTER_PLUGIN, computerPlugin } from './host/plugin.ts'
export { computerRoutes, type ComputerRoutesOptions } from './host/routes.ts'
