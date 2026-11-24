import {
  composeMessage,
  IMAGE_LIMITS,
  type FamiliarSummary,
} from '@familiar-ai/client'
import { useRoomStore } from '@familiar-ai/client/react'
import { useMutation, useMutationState } from '@tanstack/react-query'
import {
  ArchiveIcon,
  ArrowUpIcon,
  WarningCircleIcon,
  AtIcon,
  NoteIcon,
  PaperclipIcon,
  SquareIcon,
} from '@phosphor-icons/react'
import {
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from '@/components/ui/input-group'
import { imageFiles, prepareImage } from '@/lib/images'
import { titleOf, useFamiliars } from '@/lib/workspace'
import { ModelPicker } from '../model-picker'
import { DraftImages, type DraftImage } from './components/draft-images'
import { MentionMenu } from './components/mention-menu'
import { completeMention, mentionQuery, toParts } from './mentions'
import type { ComposerProps } from './types'

/**
 * What's typed, the Familiars picked from the `@` menu while typing it, the
 * images attached, and whether it goes as a note: context no one replies
 * to, which carries no images.
 */
type Draft = {
  text: string
  picked: readonly FamiliarSummary[]
  images: readonly DraftImage[]
  note: boolean
}

const empty: Draft = { text: '', picked: [], images: [], note: false }

const revoke = (images: readonly DraftImage[]) =>
  images.forEach((image) => URL.revokeObjectURL(image.url))

export const Composer = ({ room, busy }: ComposerProps) => {
  const store = useRoomStore()
  const familiars = useFamiliars()
  const input = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<Draft>(empty)
  // Why the last images couldn't be attached, until more are.
  const [refused, setRefused] = useState<string>()
  const { text, note, images } = draft
  const send = useMutation({
    mutationKey: ['composer'],
    // While busy this queues; it's answered after the current replies.
    mutationFn: ({ text, picked, note, images }: Draft) => {
      if (note) {
        return store.note(text)
      }
      const message = composeMessage(toParts(text, picked))
      return store.send(message.text, {
        mentions: message.mentions,
        images: images.map((image) => image.prepared!),
      })
    },
    onSuccess: (_result, sent) => revoke(sent.images),
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
  const ready = images.every((image) => image.prepared)
  const sendable = (!!text.trim() || images.length > 0) && ready
  const showStop = busy && !text.trim() && !images.length

  /**
   * Attaches what fits of `files`, each shown at once and sendable once
   * it's prepared. A note carries no images.
   */
  const attach = (files: File[]) => {
    const room = IMAGE_LIMITS.count - images.length
    if (note || !files.length) {
      return
    }
    setRefused(
      files.length > room
        ? `A message takes up to ${IMAGE_LIMITS.count} images.`
        : undefined,
    )
    const added = files.slice(0, Math.max(0, room)).map((file) => ({
      file,
      image: { url: URL.createObjectURL(file) },
    }))
    setDraft((draft) => ({
      ...draft,
      images: [...draft.images, ...added.map(({ image }) => image)],
    }))
    for (const { file, image } of added) {
      prepareImage(file).then(
        (prepared) =>
          setDraft((draft) => ({
            ...draft,
            images: draft.images.map((each) =>
              each.url === image.url ? { ...each, prepared } : each,
            ),
          })),
        () => {
          remove(image.url)
          setRefused("That image couldn't be read.")
        },
      )
    }
  }

  const remove = (url: string) => {
    setDraft((draft) => {
      revoke(draft.images.filter((image) => image.url === url))
      return {
        ...draft,
        images: draft.images.filter((image) => image.url !== url),
      }
    })
    input.current?.focus()
  }

  const onPaste = (event: ClipboardEvent) => {
    const files = imageFiles(event.clipboardData.files)
    // Pasted words win over a picture of them, as from a document.
    if (files.length && !event.clipboardData.types.includes('text/plain')) {
      event.preventDefault()
      attach(files)
    }
  }

  const onDrop = (event: DragEvent) => {
    const files = imageFiles(event.dataTransfer.files)
    if (files.length) {
      event.preventDefault()
      attach(files)
    }
  }

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
    if (sendable) {
      setDraft(empty)
      setRefused(undefined)
      send.mutate({ ...draft, text: text.trim() })
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
      onDragOver={(event) => {
        if (!note && event.dataTransfer.types.includes('Files')) {
          event.preventDefault()
        }
      }}
      onDrop={onDrop}
      className="relative px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      <input
        ref={picker}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          attach(imageFiles(event.target.files ?? undefined))
          event.target.value = ''
        }}
      />
      {suggestions.length > 0 && (
        <MentionMenu familiars={suggestions} onPick={mention} />
      )}
      {(refused ?? error) && (
        <p
          role="alert"
          className="mb-2 flex items-start gap-1.5 border border-destructive/40 bg-destructive/15 px-3 py-2 text-xs text-destructive backdrop-blur-xl dark:bg-destructive/25"
        >
          <WarningCircleIcon className="mt-px size-3.5 shrink-0" />
          {refused ?? error?.message}
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
      {/* The input group dims itself while anything in it is disabled, as
          Send is while the box is empty; keep the same glass either way, so
          strong colours behind it don't swamp the placeholder. */}
      <InputGroup className="bg-background/80 backdrop-blur-xl has-disabled:bg-background/80 has-disabled:opacity-100 dark:bg-[color-mix(in_oklab,var(--color-input)_30%,var(--color-background))]/80 dark:has-disabled:bg-[color-mix(in_oklab,var(--color-input)_30%,var(--color-background))]/80">
        {images.length > 0 && (
          <InputGroupAddon align="block-start" className="p-0">
            <DraftImages images={images} onRemove={remove} />
          </InputGroupAddon>
        )}
        <InputGroupTextarea
          ref={input}
          onPaste={onPaste}
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
          {!note && (
            <InputGroupButton
              size="icon-sm"
              className="size-8"
              aria-label="Attach images"
              title="Attach images"
              onClick={() => picker.current?.click()}
            >
              <PaperclipIcon />
            </InputGroupButton>
          )}
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
            className="ml-auto size-8"
            variant={note ? 'secondary' : 'ghost'}
            aria-label="Send as a note"
            aria-pressed={note}
            title={
              images.length ? 'A note carries no images' : 'Send as a note'
            }
            disabled={images.length > 0}
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
            className="size-8"
            aria-label={showStop ? 'Stop' : 'Send'}
            disabled={!showStop && !sendable}
            onClick={showStop ? () => abort.mutate() : undefined}
          >
            {showStop ? <SquareIcon /> : <ArrowUpIcon />}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  )
}
