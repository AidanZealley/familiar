import type { FamiliarSummary, Subject } from '@familiar-ai/client'

export type SubjectPageProps = {
  familiar: FamiliarSummary
  subject: Subject
  onBack: () => void
}
