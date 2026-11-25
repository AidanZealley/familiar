'use client'

import { Separator } from 'gencn'
import { defineBlock } from 'gencn/react'
import { Separator as Line } from '@/components/ui/separator'

export const separatorBlock = defineBlock(Separator, () => <Line />)
