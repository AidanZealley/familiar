export type PaneStatusProps = {
  /** Why the pane can't show its content, and what to do. Without one, it's loading. */
  problem?: string
  /** Offers Reload, for a problem a reload can fix. */
  reload?: boolean
}
