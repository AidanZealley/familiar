import {
  ArrowUpIcon,
  AtIcon,
  NoteIcon,
  SquareIcon,
} from '@phosphor-icons/react'
import { InputGroupAddon, InputGroupButton } from '@/components/ui/input-group'
import { ModelPicker } from '../../../model-picker'
import { AttachButton } from '../attach-button'
import type { ComposerActionsProps } from './types'

/**
 * The composer's row of controls: attach, the DM's model or a room's `@`,
 * then note and Send, or Stop while a Familiar replies and nothing's drafted.
 */
export const ComposerActions = ({
  room,
  note,
  hasImages,
  sendable,
  showStop,
  onAttach,
  onMention,
  onToggleNote,
  onStop,
}: ComposerActionsProps) => (
  <InputGroupAddon align="block-end" className="gap-1">
    {!note && <AttachButton onAttach={onAttach} />}
    {room.kind === 'dm' && <ModelPicker />}
    {room.kind === 'room' && (
      <InputGroupButton
        size="icon-sm"
        className="size-8"
        aria-label="Mention a Familiar"
        onClick={onMention}
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
      title={hasImages ? 'A note carries no images' : 'Send as a note'}
      disabled={hasImages}
      onClick={onToggleNote}
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
      onClick={showStop ? onStop : undefined}
    >
      {showStop ? <SquareIcon /> : <ArrowUpIcon />}
    </InputGroupButton>
  </InputGroupAddon>
)
