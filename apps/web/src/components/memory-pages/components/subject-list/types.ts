import type { FamiliarSummary, Subject } from '@familiar-ai/client'

export type SubjectListProps = {
  familiar: FamiliarSummary
  subjects: Subject[]
  onOpen: (subject: string) => void
}
