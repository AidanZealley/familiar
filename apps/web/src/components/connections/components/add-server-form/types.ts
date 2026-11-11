export type AddServerFormProps = {
  /** With why its token wasn't saved, if it wasn't. */
  onAdded(name: string, tokenError?: string): void
}
