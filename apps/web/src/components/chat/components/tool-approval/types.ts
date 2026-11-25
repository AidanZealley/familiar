export type ToolApprovalProps = {
  /** The tool, by its name in Pi, such as `mcp__home__HassUnlock`. */
  tool: string
  /** Exactly what it will be called with. */
  args: unknown
  /**
   * A card's own confirmation, written with the card: its question and
   * labels. The real tool is still named below it.
   */
  confirm?: {
    title: string
    message: string
    confirmLabel?: string
    cancelLabel?: string
  }
  pending?: boolean
  error?: string
  onApprove(): void
  onDecline(): void
}
