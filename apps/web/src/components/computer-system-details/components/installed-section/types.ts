import type { ComputerDetail } from '@/lib/computers'

export type InstalledSectionProps = Required<
  Pick<ComputerDetail, 'installed'>
> &
  Pick<ComputerDetail, 'restored'>
