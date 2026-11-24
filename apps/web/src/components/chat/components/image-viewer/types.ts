export type ImageViewerProps = {
  /** The image to show full size; kept while it fades out after closing. */
  source: string | undefined
  open: boolean
  onClose(): void
}
