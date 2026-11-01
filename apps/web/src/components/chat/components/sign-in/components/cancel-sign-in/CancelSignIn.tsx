import { Button } from '@/components/ui/button'
import { familiar } from '@/lib/familiar'

/** Stops the sign-in, back to the button that starts one. */
export const CancelSignIn = () => (
  <Button
    variant="ghost"
    onClick={() =>
      void familiar
        .getState()
        .account.cancelSignIn()
        .catch(() => {})
    }
  >
    Cancel
  </Button>
)
