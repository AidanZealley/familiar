import { Button } from '@/components/ui/button'
import type { SettingsFooterProps } from './types'

/**
 * A settings form's Discard and Save, last in the form: glass stuck to the
 * foot of the category's scroll, as the conversation's header sits over
 * the conversation. It reaches past the category's padding to its edges,
 * and down over its bottom padding, so it meets the dialog's foot.
 */
export const SettingsFooter = ({ canSave, onDiscard }: SettingsFooterProps) => (
  <div className="sticky bottom-0 z-10 -mx-4 -mb-[max(1.5rem,env(safe-area-inset-bottom))] flex justify-end gap-2 border-t bg-popover/80 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md md:-mx-6 md:px-6">
    {onDiscard && (
      <Button type="button" variant="outline" onClick={onDiscard}>
        Discard
      </Button>
    )}
    <Button type="submit" disabled={!canSave}>
      Save
    </Button>
  </div>
)
