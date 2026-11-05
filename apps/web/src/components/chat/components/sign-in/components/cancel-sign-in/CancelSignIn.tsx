import { useFamiliarStore } from '@/lib/familiar'
import { Button } from '@/components/ui/button'

/** Stops the sign-in, back to the button that starts one. */
export const CancelSignIn = () => {
  const {
    account: { cancelSignIn },
  } = useFamiliarStore()
  return (
    <Button variant="ghost" onClick={() => void cancelSignIn().catch(() => {})}>
      Cancel
    </Button>
  )
}
