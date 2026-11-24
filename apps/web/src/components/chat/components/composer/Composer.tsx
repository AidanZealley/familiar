import type { FamiliarSummary } from '@familiar-ai/client'
import {
  useRef,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupTextarea,
} from '@/components/ui/input-group'
import { titleOf, useFamiliars } from '@/lib/workspace'
import { ArchivedNotice } from './components/archived-notice'
import { ComposerActions } from './components/composer-actions'
import { ComposerNotice } from './components/composer-notice'
import { DraftImages } from './components/draft-images'
import { FailedSendItem } from './components/failed-send-item'
import { MentionMenu } from './components/mention-menu'
import { suggestionsFor } from './mentions'
import type { ComposerProps } from './types'
import { isEmpty, refusalOf, useDraft } from './useDraft'
import { useSend } from './useSend'

/**
 * Writing to a room: words, `@` mentions and images, sent as a message or
 * a note. `useDraft` owns what's drafted, and `useSend` the commands and
 * the sends that failed, each shown above the draft and never merged into
 * it; this wires them to the input.
 */
export const Composer = ({ room, busy }: ComposerProps) => {
  const familiars = useFamiliars()
  const input = useRef<HTMLTextAreaElement>(null)
  const drafting = useDraft()
  const { draft, refused, sendable } = drafting
  const { text, note, images } = draft
  const sending = useSend()
  const { send, stop, error, failed } = sending
  const title = titleOf(room, familiars)
  const focus = () => input.current?.focus()

  const suggestions = suggestionsFor(room, familiars, text, note)

  const mention = (familiar: FamiliarSummary) => {
    drafting.mention(familiar)
    focus()
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (sendable) {
      send(drafting.take())
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

  const onPaste = (event: ClipboardEvent) => {
    const files = [...event.clipboardData.files]
    // Pasted words win over a picture of them, as from a document.
    if (files.length && !event.clipboardData.types.includes('text/plain')) {
      event.preventDefault()
      drafting.attach(files)
    }
  }

  // Any files dropped here are the draft's, never the browser's to open.
  const onDrop = (event: DragEvent) => {
    const files = [...event.dataTransfer.files]
    if (files.length) {
      event.preventDefault()
      drafting.attach(files)
    }
  }

  if (room.kind === 'room' && room.archived) {
    return <ArchivedNotice />
  }

  return (
    <form
      onSubmit={submit}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault()
        }
      }}
      onDrop={onDrop}
      className="relative px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      {suggestions.length > 0 && (
        <MentionMenu familiars={suggestions} onPick={mention} />
      )}
      {failed.map((each) => (
        <FailedSendItem
          key={each.id}
          failed={each}
          onRetry={() => sending.retry(each)}
          onEdit={
            isEmpty(draft)
              ? () => {
                  drafting.edit(each.draft)
                  sending.discard(each.id)
                  focus()
                }
              : undefined
          }
          onDiscard={() => sending.discard(each.id)}
          onRemoveImage={(image) => sending.removeImage(each.id, image)}
        />
      ))}
      {(refused ?? refusalOf(draft) ?? error) && (
        <ComposerNotice tone="error">
          {refused ?? refusalOf(draft) ?? error?.message}
        </ComposerNotice>
      )}
      {note && (
        <ComposerNotice tone="note">
          Sends as a note: context for{' '}
          {room.kind === 'dm' ? title : 'the Familiars here'}, with no reply.
        </ComposerNotice>
      )}
      {/* The input group dims itself while anything in it is disabled, as
          Send is while the box is empty; keep the same glass either way, so
          strong colours behind it don't swamp the placeholder. */}
      <InputGroup className="bg-background/80 backdrop-blur-xl has-disabled:bg-background/80 has-disabled:opacity-100 dark:bg-[color-mix(in_oklab,var(--color-input)_30%,var(--color-background))]/80 dark:has-disabled:bg-[color-mix(in_oklab,var(--color-input)_30%,var(--color-background))]/80">
        {images.length > 0 && (
          <InputGroupAddon align="block-start" className="p-0">
            <DraftImages
              images={images}
              onRemove={(id) => {
                drafting.remove(id)
                focus()
              }}
            />
          </InputGroupAddon>
        )}
        <InputGroupTextarea
          ref={input}
          value={text}
          onChange={(event) => drafting.type(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          enterKeyHint="enter"
          aria-label={note ? `Note for ${title}` : `Message ${title}`}
          placeholder={note ? `Note for ${title}` : `Message ${title}`}
          rows={1}
          className="max-h-48 p-3 text-sm md:text-sm"
        />
        <ComposerActions
          room={room}
          note={note}
          hasImages={images.length > 0}
          sendable={sendable}
          showStop={busy && !text.trim() && !images.length}
          onAttach={drafting.attach}
          onMention={() => {
            drafting.startMention()
            focus()
          }}
          onToggleNote={() => {
            drafting.toggleNote()
            focus()
          }}
          onStop={stop}
        />
      </InputGroup>
    </form>
  )
}
