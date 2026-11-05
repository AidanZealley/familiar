import { familiar } from '@/lib/familiar'
import { Button } from '@/components/ui/button'

/** Stops the sign-in, back to the button that starts one. */
export const CancelSignIn = () => {
  return (
    <Button
      variant="ghost"
      onClick={() => void familiar.account.cancelSignIn().catch(() => {})}
    >
      Cancel
    </Button>
  )
}
