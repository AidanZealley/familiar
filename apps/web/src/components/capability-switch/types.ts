import type { ConnectionInfo } from '@familiar-ai/client'
import type { ReactNode } from 'react'

/** What a Familiar uses, or what a new one starts with: plugins and MCP servers by name. */
export type Capabilities = { plugins: string[]; mcp: string[] }

/** Whose capabilities a switch changes, and how. */
export type CapabilitySource = {
  /** Their query, which a change refreshes. */
  key: readonly unknown[]
  get(): Promise<Capabilities>
  /** Each list given replaces that kind's. */
  set(change: Partial<Capabilities>): Promise<void>
}

export type CapabilitySwitchProps = {
  connection: ConnectionInfo
  source: CapabilitySource
  /** Says whose it is, such as `Atlas uses Home Assistant`. */
  label: string
  /** Asks before switching it off, such as when that deletes something. */
  confirmOff?: (dialog: ConfirmDialogProps) => ReactNode
}

/** A confirmation the caller shows, controlled by whoever asks. */
export type ConfirmDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}
