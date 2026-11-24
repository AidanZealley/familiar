import { PaperclipIcon } from '@phosphor-icons/react'
import { useRef } from 'react'
import { InputGroupButton } from '@/components/ui/input-group'
import type { AttachButtonProps } from './types'

/** Opens the device's picker for images to attach. */
export const AttachButton = ({ onAttach }: AttachButtonProps) => {
  const picker = useRef<HTMLInputElement>(null)
  return (
    <>
      <input
        ref={picker}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          onAttach([...(event.target.files ?? [])])
          // So picking the same image again still counts as a change.
          event.target.value = ''
        }}
      />
      <InputGroupButton
        size="icon-sm"
        className="size-8"
        aria-label="Attach images"
        title="Attach images"
        // Leaves focus in the text box, so a phone's keyboard stays up and
        // the composer doesn't move away from the picker's menu.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => picker.current?.click()}
      >
        <PaperclipIcon />
      </InputGroupButton>
    </>
  )
}
