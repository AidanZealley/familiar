export type SettingsFooterProps = {
  /** Whether there's a valid change to save, and no save under way. */
  canSave: boolean
  /** Puts the form back as it was; Discard shows only while it's given. */
  onDiscard?: () => void
}
