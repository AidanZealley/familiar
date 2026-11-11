import { composeMessage, type FamiliarSummary } from '@familiar-ai/client'
import { useRoomStore } from '@familiar-ai/client/react'
import { useMutation, useMutationState } from '@tanstack/react-query'
import {
  ArchiveIcon,
  ArrowUpIcon,
  AtSignIcon,
  CrownIcon,
  SquareIcon,
  UsersIcon,
} from 'lucide-react'
import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from '@/components/ui/input-group'
import { nameOf, titleOf, useFamiliars } from '@/lib/workspace'
import { ModelPicker } from '../model-picker'
import { MentionMenu } from './components/mention-menu'
import { completeMention, mentionQuery, toParts } from './mentions'
import type { ComposerProps } from './types'

/** What's typed, and the Familiars picked from the `@` menu while typing it. */
type Draft = { text: string; picked: readonly FamiliarSummary[] }

const empty: Draft = { text: '', picked: [] }

export const Composer = ({ room, busy }: ComposerProps) => {
  const store = useRoomStore()
  const familiars = useFamiliars()
  const input = useRef<HTMLTextAreaElement>(null)
  const [draft, setDraft] = useState<Draft>(empty)
  const { text } = draft
  const send = useMutation({
    mutationKey: ['composer'],
    // While busy this queues; it's answered after the current replies.
    mutationFn: ({ text, picked }: Draft) => {
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
  const query = mentionQuery(text)
  const suggestions =
    query === undefined
      ? []
      : members.filter((familiar) =>
          familiar.name.toLowerCase().startsWith(query.toLowerCase()),
        )
  const title = titleOf(room, familiars)

  const mention = (familiar: FamiliarSummary) => {
    setDraft({
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
      send.mutate({ text: message, picked: draft.picked })
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
      <p className="mx-4 mt-2 mb-[max(1rem,env(safe-area-inset-bottom))] flex items-center justify-center gap-1.5 border border-dashed p-3 text-xs text-muted-foreground">
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
      <InputGroup className="has-disabled:bg-transparent has-disabled:opacity-100 dark:has-disabled:bg-input/30">
        <InputGroupTextarea
          ref={input}
          value={text}
          onChange={(event) => setDraft({ ...draft, text: event.target.value })}
          onKeyDown={onKeyDown}
          enterKeyHint="enter"
          aria-label={`Message ${title}`}
          placeholder={`Message ${title}`}
          rows={1}
          className="max-h-48 p-3 text-sm md:text-sm"
        />
        <InputGroupAddon align="block-end" className="gap-1">
          {room.kind === 'dm' && <ModelPicker />}
          {room.kind === 'room' && (
            <InputGroupButton
              size="icon-sm"
              aria-label="Mention a Familiar"
              onClick={() => {
                setDraft({
                  ...draft,
                  text: `${text}${text && !/\s$/.test(text) ? ' ' : ''}@`,
                })
                input.current?.focus()
              }}
            >
              <AtSignIcon />
            </InputGroupButton>
          )}
          <InputGroupButton
            type={showStop ? 'button' : 'submit'}
            size="icon-sm"
            variant={showStop ? 'secondary' : 'default'}
            className="ml-auto"
            aria-label={showStop ? 'Stop' : 'Send'}
            disabled={!showStop && !text.trim()}
            onClick={showStop ? () => abort.mutate() : undefined}
          >
            {showStop ? <SquareIcon /> : <ArrowUpIcon />}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      {error && (
        <p className="mt-2 text-xs text-destructive">{error.message}</p>
      )}
      {room.kind === 'room' && (
        <p className="mt-2 flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
          {room.lead === undefined ? (
            <UsersIcon className="size-3.5 shrink-0" />
          ) : (
            <CrownIcon className="size-3.5 shrink-0" />
          )}
          {room.lead === undefined
            ? 'Open room: each Familiar here may answer, in turn. @mention one to ask it.'
            : `${nameOf(familiars, room.lead)} leads: it answers first and hands off. @mention anyone to ask them.`}
        </p>
      )}
    </form>
  )
}
