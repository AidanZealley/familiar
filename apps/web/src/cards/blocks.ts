// The installed view for every block in the catalog: one missing here, or
// one the catalog doesn't list, doesn't compile.
import { createBlocks } from 'gencn/react'
import { badgeBlock } from '@/components/generative/badge-block'
import { buttonBlock } from '@/components/generative/button-block'
import { cardBlock } from '@/components/generative/card-block'
import { gridBlock } from '@/components/generative/grid-block'
import { headingBlock } from '@/components/generative/heading-block'
import { imageBlock } from '@/components/generative/image-block'
import { selectBlock } from '@/components/generative/select-block'
import { separatorBlock } from '@/components/generative/separator-block'
import { sliderBlock } from '@/components/generative/slider-block'
import { stackBlock } from '@/components/generative/stack-block'
import { statBlock } from '@/components/generative/stat-block'
import { switchBlock } from '@/components/generative/switch-block'
import { textBlock } from '@/components/generative/text-block'
import { catalog } from './catalog'

export const blocks = createBlocks(catalog, [
  cardBlock,
  stackBlock,
  gridBlock,
  separatorBlock,
  headingBlock,
  textBlock,
  imageBlock,
  statBlock,
  badgeBlock,
  switchBlock,
  sliderBlock,
  selectBlock,
  buttonBlock,
])
