import { KeyboardIcon } from '@phosphor-icons/react'
import { cn } from 'cn'
import { useRef, useState } from 'react'
import { TakeOverButton } from '@/components/take-over-button'
import { Button } from '@/components/ui/button'
import type { ScreenControlsProps } from './types'

/** On a phone held upright, where the screen is small: one short row. */
const COMPACT = 'stacked:h-6 stacked:px-1.5 stacked:text-[11px]'

/** X keysyms for the keys a phone's keyboard lacks. */
const KEYS = [
  { label: 'Esc', name: 'Escape', keysym: 0xff1b, code: 'Escape' },
  { label: 'Tab', name: 'Tab', keysym: 0xff09, code: 'Tab' },
  {
    label: 'Ctrl',
    name: 'Control',
    keysym: 0xffe3,
    code: 'ControlLeft',
    latches: true,
  },
  { label: 'Alt', name: 'Alt', keysym: 0xffe9, code: 'AltLeft', latches: true },
  { label: '⌫', name: 'Backspace', keysym: 0xff08, code: 'Backspace' },
  { label: '↵', name: 'Enter', keysym: 0xff0d, code: 'Enter' },
] as const
const BACKSPACE = KEYS[4]
const ENTER = KEYS[5]

/** A character's X keysym: Latin-1 as itself, anything else as Unicode. */
const keysymOf = (character: string) => {
  const point = character.codePointAt(0)!
  return point < 0x100 ? point : 0x01000000 + point
}

/**
 * Over a full screen's corner (its bottom centre on a phone): Take over
 * while watching, and while this tab has control, a keyboard for a phone,
 * the keys it lacks, and Hand back. Ctrl and Alt stay down until the next
 * key from here, or until tapped again.
 */
export const ScreenControls = ({
  familiar,
  controlling,
  sendKey,
  attention,
}: ScreenControlsProps) => {
  const input = useRef<HTMLInputElement>(null)
  /** What the hidden field held, to find what each change typed or deleted. */
  const typed = useRef('')
  const [latched, setLatched] = useState<ReadonlySet<number>>(new Set())

  /** Presses a key with any latched modifiers, then lets them go. */
  const press = (keysym: number, code: string | null) => {
    sendKey(keysym, code)
    for (const key of KEYS) {
      if (latched.has(key.keysym)) {
        sendKey(key.keysym, key.code, false)
      }
    }
    setLatched(new Set())
  }
  const toggle = (keysym: number, code: string) => {
    const down = !latched.has(keysym)
    sendKey(keysym, code, down)
    const next = new Set(latched)
    if (down) {
      next.add(keysym)
    } else {
      next.delete(keysym)
    }
    setLatched(next)
  }

  // A phone's keyboard composes words and corrects them in place, so the
  // field's text is compared with what it held: what went is deleted with
  // Backspace, and what came is typed.
  const onInput = () => {
    const field = input.current!
    const before = typed.current
    const after = field.value
    let same = 0
    while (same < before.length && before[same] === after[same]) {
      same++
    }
    for (let i = same; i < before.length; i++) {
      press(BACKSPACE.keysym, BACKSPACE.code)
    }
    for (const character of after.slice(same)) {
      if (character === '\n') {
        press(ENTER.keysym, ENTER.code)
      } else {
        press(keysymOf(character), null)
      }
    }
    typed.current = after
  }

  return (
    <div
      // A click here is for these controls, never "take over to use it",
      // and leaves the keyboard's focus on the screen.
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.preventDefault()}
      // Only the controls take clicks; the screen around them still does.
      className="pointer-events-none absolute inset-x-2 bottom-2 z-10 flex flex-wrap items-center justify-center gap-1 *:pointer-events-auto docked:justify-end stacked:bottom-1 stacked:flex-nowrap"
    >
      {controlling && (
        <>
          <input
            ref={input}
            aria-label="Type on the screen"
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className="pointer-events-none! absolute size-px opacity-0"
            onInput={onInput}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                press(ENTER.keysym, ENTER.code)
              } else if (event.key === 'Backspace' && !input.current!.value) {
                press(BACKSPACE.keysym, BACKSPACE.code)
              }
            }}
            onBlur={() => {
              input.current!.value = ''
              typed.current = ''
            }}
          />
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Keyboard"
            title="Keyboard"
            className="stacked:size-6"
            onClick={() => input.current!.focus()}
          >
            <KeyboardIcon />
          </Button>
          {KEYS.map((key) =>
            'latches' in key ? (
              <Button
                key={key.label}
                variant="outline"
                size="sm"
                aria-label={key.name}
                aria-pressed={latched.has(key.keysym)}
                className={cn(
                  'font-mono',
                  COMPACT,
                  latched.has(key.keysym) &&
                    'bg-primary text-primary-foreground hover:bg-primary/80',
                )}
                onClick={() => toggle(key.keysym, key.code)}
              >
                {key.label}
              </Button>
            ) : (
              <Button
                key={key.label}
                variant="outline"
                size="sm"
                aria-label={key.name}
                className={cn('font-mono', COMPACT)}
                onClick={() => press(key.keysym, key.code)}
              >
                {key.label}
              </Button>
            ),
          )}
        </>
      )}
      <TakeOverButton
        familiar={familiar}
        attention={attention}
        className={cn('shadow-lg', controlling && COMPACT)}
      />
    </div>
  )
}
