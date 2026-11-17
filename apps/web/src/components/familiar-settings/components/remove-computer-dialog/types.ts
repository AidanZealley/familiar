import type { FamiliarSummary } from '@familiar-ai/client'
import type { ConfirmDialogProps } from '@/components/capability-switch'

export type RemoveComputerDialogProps = ConfirmDialogProps & {
  familiar: FamiliarSummary
}
