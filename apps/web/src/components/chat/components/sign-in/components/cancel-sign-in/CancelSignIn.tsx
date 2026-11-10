import { useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { workspace } from '@/lib/familiar'

/** Stops the sign-in, back to the button that starts one. */
export const CancelSignIn = () => {
  const cancel = useMutation({
    mutationKey: ['sign-in'],
    mutationFn: () => workspace.account.cancelSignIn(),
  })

  return (
    <Button
      variant="ghost"
      disabled={cancel.isPending}
      onClick={() => cancel.mutate()}
    >
      Cancel
    </Button>
  )
}
