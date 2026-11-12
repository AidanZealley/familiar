import { composeMessage, type FamiliarSummary } from '@familiar-ai/client'
import { useRoomStore } from '@familiar-ai/client/react'
import { useMutation, useMutationState } from '@tanstack/react-query'
import {
  ArchiveIcon,
  ArrowUpIcon,
  WarningCircleIcon,
  AtIcon,
  NoteIcon,
  SquareIcon,
} from '@phosphor-icons/react'
import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from '@/components/ui/input-group'
import { titleOf, useFamiliars } from '@/lib/workspace'
import { ModelPicker } from '../model-picker'
import { MentionMenu } from './components/mention-menu'
import { completeMention, mentionQuery, toParts } from './mentions'
import type { ComposerProps } from './types'

/**
 * What's typed, the Familiars picked from the `@` menu while typing it, and
 * whether it goes as a note: context no one replies to.
 */
type Draft = { text: string; picked: readonly FamiliarSummary[]; note: boolean }

const empty: Draft = { text: '', picked: [], note: false }

export const Composer = ({ room, busy }: ComposerProps) => {
  const store = useRoomStore()
  const familiars = useFamiliars()
  const input = useRef<HTMLTextAreaElement>(null)
  const [draft, setDraft] = useState<Draft>(empty)
  const { text, note } = draft
  const send = useMutation({
    mutationKey: ['composer'],
    // While busy this queues; it's answered after the current replies.
    mutationFn: ({ text, picked, note }: Draft) => {
      if (note) {
        return store.note(text)
      }
      const message = composeMessage(toParts(text, picked))
      return store.send(message.text, message.mentions)
    },
    onError: (_error, sent) => setDraft(sent),
  })
  const abort = useMutation({
    mutationKey: ['composer'],
    mutationFn: () => store.stop(),
  })
  // Every command here, the model picker's too, shares the composer's key:
  // the latest one's failure shows below it until another succeeds.
  const error = useMutationState({
    filters: { mutationKey: ['composer'] },
    select: (mutation) => mutation.state.error,
  }).at(-1)
  const showStop = busy && !text.trim()

  // Only a named room's Familiars need addressing; a DM has one.
  const members =
    room.kind === 'room'
      ? familiars.filter((familiar) => room.familiars.includes(familiar.id))
      : []
  // A note addresses no one.
  const query = note ? undefined : mentionQuery(text)
  const suggestions =
    query === undefined
      ? []
      : members.filter((familiar) =>
          familiar.name.toLowerCase().startsWith(query.toLowerCase()),
        )
  const title = titleOf(room, familiars)

  const mention = (familiar: FamiliarSummary) => {
    setDraft({
      ...draft,
      text: completeMention(text, familiar),
      picked: [...draft.picked, familiar],
    })
    input.current?.focus()
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const message = text.trim()
    if (message) {
      setDraft(empty)
      send.mutate({ ...draft, text: message })
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) {
      return
    }
    if (suggestions[0] && (event.key === 'Tab' || event.key === 'Enter')) {
      event.preventDefault()
      mention(suggestions[0])
      return
    }
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      window.matchMedia('(hover: hover) and (pointer: fine)').matches
    ) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  if (room.kind === 'room' && room.archived) {
    return (
      <p className="mx-4 mt-2 mb-[max(1rem,env(safe-area-inset-bottom))] flex items-center justify-center gap-1.5 border border-dashed bg-background/80 p-3 text-xs text-muted-foreground backdrop-blur-xl">
        <ArchiveIcon className="size-3.5" />
        Archived: its history stays, and it takes no new messages.
      </p>
    )
  }

  return (
    <form
      onSubmit={submit}
      className="relative px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      {suggestions.length > 0 && (
        <MentionMenu familiars={suggestions} onPick={mention} />
      )}
      {error && (
        <p
          role="alert"
          className="mb-2 flex items-start gap-1.5 border border-destructive/40 bg-destructive/15 px-3 py-2 text-xs text-destructive backdrop-blur-xl dark:bg-destructive/25"
        >
          <WarningCircleIcon className="mt-px size-3.5 shrink-0" />
          {error.message}
        </p>
      )}
      {note && (
        <p
          role="status"
          className="mb-2 flex items-start gap-1.5 border bg-background/80 px-3 py-2 text-xs text-muted-foreground backdrop-blur-xl"
        >
          <NoteIcon className="mt-px size-3.5 shrink-0" />
          Sends as a note: context for{' '}
          {room.kind === 'dm' ? title : 'the Familiars here'}, with no reply.
        </p>
      )}
      <InputGroup className="bg-background/80 backdrop-blur-xl has-disabled:bg-transparent has-disabled:opacity-100 dark:bg-[color-mix(in_oklab,var(--color-input)_30%,var(--color-background))]/80 dark:has-disabled:bg-input/30">
        <InputGroupTextarea
          ref={input}
          value={text}
          onChange={(event) => setDraft({ ...draft, text: event.target.value })}
          onKeyDown={onKeyDown}
          enterKeyHint="enter"
          aria-label={note ? `Note for ${title}` : `Message ${title}`}
          placeholder={note ? `Note for ${title}` : `Message ${title}`}
          rows={1}
          className="max-h-48 p-3 text-sm md:text-sm"
        />
        <InputGroupAddon align="block-end" className="gap-1">
          {room.kind === 'dm' && <ModelPicker />}
          {room.kind === 'room' && (
            <InputGroupButton
              size="icon-sm"
              className="size-8"
              aria-label="Mention a Familiar"
              onClick={() => {
                setDraft({
                  ...draft,
                  text: `${text}${text && !/\s$/.test(text) ? ' ' : ''}@`,
                })
                input.current?.focus()
              }}
            >
              <AtIcon />
            </InputGroupButton>
          )}
          <InputGroupButton
            size="icon-sm"
            className="size-8"
            variant={note ? 'secondary' : 'ghost'}
            aria-label="Send as a note"
            aria-pressed={note}
            title="Send as a note"
            onClick={() => {
              setDraft({ ...draft, note: !note })
              input.current?.focus()
            }}
          >
            <NoteIcon weight={note ? 'fill' : 'regular'} />
          </InputGroupButton>
          <InputGroupButton
            type={showStop ? 'button' : 'submit'}
            size="icon-sm"
            variant={showStop ? 'secondary' : 'default'}
            className="ml-auto size-8"
            aria-label={showStop ? 'Stop' : 'Send'}
            disabled={!showStop && !text.trim()}
            onClick={showStop ? () => abort.mutate() : undefined}
          >
            {showStop ? <SquareIcon /> : <ArrowUpIcon />}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  )
}
