import { useFamiliar } from '@familiar-ai/client/react'
import { Button } from '@/components/ui/button'

/** Stops the sign-in, back to the button that starts one. */
export const CancelSignIn = () => {
  const cancelSignIn = useFamiliar((state) => state.account.cancelSignIn)
  return (
    <Button variant="ghost" onClick={() => void cancelSignIn().catch(() => {})}>
      Cancel
    </Button>
  )
}
