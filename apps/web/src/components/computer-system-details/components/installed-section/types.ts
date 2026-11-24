import type { ComputerDetail } from '@familiar-ai/computer'

export type InstalledSectionProps = Required<
  Pick<ComputerDetail, 'installed'>
> &
  Pick<ComputerDetail, 'restored'>
