export type YearNavProps = {
  /** `YYYY-MM`, newest first, as the timeline lists them. */
  months: string[]
  active: string | undefined
  onSelect: (month: string) => void
  /** A capsule for a phone's bottom edge instead of a side rail. */
  horizontal?: boolean
}
