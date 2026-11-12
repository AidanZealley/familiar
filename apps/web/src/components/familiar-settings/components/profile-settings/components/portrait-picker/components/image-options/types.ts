import type { FamiliarSummary } from '@familiar-ai/client'
import type { PortraitImages } from '@/lib/avatars'

export type ImageOptionsProps = {
  familiar: Pick<FamiliarSummary, 'id' | 'name'>
  images: PortraitImages
  value: string | null
  onChange(value: string | null): void
}
