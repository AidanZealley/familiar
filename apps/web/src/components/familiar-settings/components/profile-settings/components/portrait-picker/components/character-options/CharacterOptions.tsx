import { cn } from 'cn'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { characterAvatar } from '@/lib/avatars'
import { COLOURS, colourOf } from '@/lib/characters'
import { PortraitOption } from '../portrait-option'
import type { CharacterOptionsProps } from './types'

const PAGE = 32
const heading = 'text-xs text-muted-foreground'

/**
 * Shapes, in the chosen colour, then colours, chosen apart. The shape its ID
 * gives comes first and a chosen one stays in view; each Familiar sees its
 * own run of others, a page at a time.
 */
export const CharacterOptions = ({
  familiar,
  portrait,
  onChange,
}: CharacterOptionsProps) => {
  const [count, setCount] = useState(PAGE - 1)
  const character = portrait.kind === 'character' ? portrait : undefined
  const shape = character?.shape ?? familiar.id
  const colour = character?.colour ?? colourOf(familiar.id)
  const others = Array.from(
    { length: count },
    (_, i) => familiar.id * 97 + i + 1,
  )
  const shapes = [familiar.id, ...others]
  if (!shapes.includes(shape)) {
    shapes.splice(1, 0, shape)
  }
  const choose = (next: { shape?: number; colour?: number }) =>
    onChange(
      characterAvatar(familiar, next.shape ?? shape, next.colour ?? colour),
    )

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <p className={heading}>Shape</p>
        <div role="group" aria-label="Shapes" className="flex flex-wrap gap-1">
          {shapes.map((each) => (
            <PortraitOption
              key={each}
              familiar={familiar}
              avatar={characterAvatar(familiar, each, colour)}
              selected={character?.shape === each}
              onSelect={() => choose({ shape: each })}
              name={each === familiar.id ? 'Its own shape' : `Shape ${each}`}
            />
          ))}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => setCount(count + PAGE)}
        >
          More shapes
        </Button>
      </div>
      <div className="flex flex-col gap-1.5">
        <p className={heading}>Colour</p>
        <div
          role="group"
          aria-label="Colours"
          className="flex flex-wrap gap-1.5"
        >
          {COLOURS.map((swatch, index) => (
            <button
              key={swatch}
              type="button"
              aria-pressed={character?.colour === index}
              aria-label={`Colour ${index + 1}`}
              onClick={() => choose({ colour: index })}
              className={cn(
                'size-6 outline-offset-2 aria-pressed:outline-2 aria-pressed:outline-foreground',
              )}
              style={{ background: swatch }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
