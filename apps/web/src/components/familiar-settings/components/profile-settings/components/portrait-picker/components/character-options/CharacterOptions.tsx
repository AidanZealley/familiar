import { ArrowUUpLeftIcon, DiceFiveIcon } from '@phosphor-icons/react'
import { cn } from 'cn'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { characterAvatar } from '@/lib/avatars'
import { COLOURS, colourOf } from '@/lib/characters'
import { PortraitOption } from '../portrait-option'
import type { CharacterOptionsProps } from './types'

const TRAY = 24
const heading = 'text-xs text-muted-foreground'

/**
 * Shapes, in the chosen colour, then colours, chosen apart. The big
 * portrait beside them shows the choice; the shapes are a tray to browse,
 * from the run its ID gives, starting with the shape its ID gives it.
 * Shuffle swaps the tray for the next and Back returns to the last;
 * closing the dialog forgets where it was.
 */
export const CharacterOptions = ({
  familiar,
  portrait,
  onChange,
}: CharacterOptionsProps) => {
  const [page, setPage] = useState(0)
  const shuffle = useRef<HTMLButtonElement>(null)
  const character = portrait.kind === 'character' ? portrait : undefined
  const shape = character?.shape ?? familiar.id
  const colour = character?.colour ?? colourOf(familiar.id)
  // Its own shape opens the first tray, then the run's; each later tray
  // takes the next TRAY of the run.
  const tray = Array.from({ length: TRAY }, (_, i) =>
    page === 0 && i === 0 ? familiar.id : familiar.id * 97 + page * TRAY + i,
  )
  const choose = (next: { shape?: number; colour?: number }) =>
    onChange(
      characterAvatar(familiar, next.shape ?? shape, next.colour ?? colour),
    )

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <p className={heading}>Shape</p>
        <div
          role="group"
          aria-label="Shapes"
          className="flex flex-col gap-2 border bg-muted/40 p-2"
        >
          <div className="flex flex-wrap gap-1">
            {tray.map((each) => (
              <PortraitOption
                key={each}
                familiar={familiar}
                avatar={characterAvatar(familiar, each, colour)}
                selected={character?.shape === each}
                onSelect={() => choose({ shape: each })}
                name={`Shape ${each}`}
              />
            ))}
          </div>
          <div className="flex justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(page === 0 && 'invisible')}
              onClick={() => {
                setPage(page - 1)
                // Back hides on the first tray, so focus moves on to Shuffle.
                if (page === 1) {
                  shuffle.current?.focus()
                }
              }}
            >
              <ArrowUUpLeftIcon />
              Back
            </Button>
            <Button
              ref={shuffle}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPage(page + 1)}
            >
              <DiceFiveIcon />
              Shuffle
            </Button>
          </div>
        </div>
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
