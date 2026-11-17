import type { FamiliarSummary } from '@familiar-ai/client'
import type { ComputerLogin } from '@/lib/computers'

export type LoginFormProps = {
  familiar: FamiliarSummary
  /** The login to replace, whose site stays; none to add one. */
  login?: ComputerLogin
  onClose: () => void
}
