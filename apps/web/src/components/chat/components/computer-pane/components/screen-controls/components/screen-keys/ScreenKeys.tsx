import { KeyboardIcon } from '@phosphor-icons/react'
import { cn } from 'cn'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { COMPACT } from '../../compact'
import type { ScreenKeysProps } from './types'

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
 * While this tab has control: a keyboard for a phone, and the keys it
 * lacks. Ctrl and Alt, once tapped, go with the next key from here (or are
 * tapped off); they belong to one hold, as this is shown only during it.
 */
export const ScreenKeys = ({ sendKey }: ScreenKeysProps) => {
  const input = useRef<HTMLInputElement>(null)
  /** What the hidden field held, to find what each change typed or deleted. */
  const typed = useRef('')
  const [latched, setLatched] = useState<ReadonlySet<number>>(new Set())

  /**
   * Presses keys in turn, the first with any latched modifiers around it,
   * then unlatches them. Latches are only ours until then: the screen never
   * holds a key down, so a reconnect or a new take-over can't leave one
   * stuck. One call per event, so the latches it reads are current.
   */
  const press = (
    ...keys: (readonly [keysym: number, code: string | null])[]
  ) => {
    const modifiers = KEYS.filter((key) => latched.has(key.keysym))
    keys.forEach(([keysym, code], index) => {
      const held = index === 0 ? modifiers : []
      for (const key of held) {
        sendKey(key.keysym, key.code, true)
      }
      sendKey(keysym, code)
      for (const key of held.toReversed()) {
        sendKey(key.keysym, key.code, false)
      }
    })
    setLatched(new Set())
  }
  const toggle = (keysym: number) => {
    const next = new Set(latched)
    if (!next.delete(keysym)) {
      next.add(keysym)
    }
    setLatched(next)
  }
  /** Whether the phone's keyboard is composing a word it may still change. */
  const composing = useRef(false)

  // A phone's keyboard composes words and corrects them in place, so the
  // field's text is compared with what it held: what went is deleted with
  // Backspace, and what came is typed. A word being composed waits until
  // the keyboard commits it, so nothing provisional reaches the screen.
  const onInput = () => {
    if (composing.current) {
      return
    }
    const field = input.current!
    const before = typed.current
    const after = field.value
    let same = 0
    while (same < before.length && before[same] === after[same]) {
      same++
    }
    press(
      ...Array.from(
        { length: before.length - same },
        () => [BACKSPACE.keysym, BACKSPACE.code] as const,
      ),
      ...[...after.slice(same)].map((character) =>
        character === '\n'
          ? ([ENTER.keysym, ENTER.code] as const)
          : ([keysymOf(character), null] as const),
      ),
    )
    typed.current = after
  }

  return (
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
        onCompositionStart={() => (composing.current = true)}
        onCompositionEnd={() => {
          composing.current = false
          onInput()
        }}
        onKeyDown={(event) => {
          // The keyboard's own while it composes, such as Enter picking
          // a word: what it commits arrives as text.
          if (event.nativeEvent.isComposing) {
            return
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            press([ENTER.keysym, ENTER.code])
          } else if (event.key === 'Backspace' && !input.current!.value) {
            press([BACKSPACE.keysym, BACKSPACE.code])
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
            onClick={() => toggle(key.keysym)}
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
            onClick={() => press([key.keysym, key.code])}
          >
            {key.label}
          </Button>
        ),
      )}
    </>
  )
}
