import { useState } from 'react'
import { PixelAvatar } from '@/components/pixel-avatar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  INITIAL,
  portraitOf,
  usePortraitImages,
  type Portrait,
} from '@/lib/avatars'
import { CharacterOptions } from './components/character-options'
import { ImageOptions } from './components/image-options'
import { PortraitOption } from './components/portrait-option'
import type { PortraitPickerProps } from './types'

/**
 * The portrait, large, beside its three kinds: its initial, a generated
 * character, or one of the owner's images. Opens on the kind it has.
 */
export const PortraitPicker = ({
  familiar,
  value,
  onChange,
}: PortraitPickerProps) => {
  const images = usePortraitImages()
  const draft = { ...familiar, avatar: value ?? undefined }
  const portrait = portraitOf(draft, images.names)
  const [kind, setKind] = useState<Portrait['kind']>(portrait.kind)

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
      <PixelAvatar familiar={draft} scale={3} />
      <Tabs
        value={kind}
        onValueChange={(next) => setKind(next as Portrait['kind'])}
        className="min-w-0 flex-1 gap-3"
      >
        <TabsList>
          <TabsTrigger value="character">Character</TabsTrigger>
          <TabsTrigger value="initial">Initial</TabsTrigger>
          <TabsTrigger value="image">Image</TabsTrigger>
        </TabsList>
        <TabsContent value="character">
          <CharacterOptions
            familiar={familiar}
            portrait={portrait}
            onChange={onChange}
          />
        </TabsContent>
        <TabsContent value="initial">
          <PortraitOption
            familiar={familiar}
            avatar={INITIAL}
            selected={portrait.kind === 'initial'}
            onSelect={() => onChange(INITIAL)}
            name="Its initial"
          />
        </TabsContent>
        <TabsContent value="image">
          <ImageOptions
            familiar={familiar}
            images={images}
            value={value}
            onChange={onChange}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
