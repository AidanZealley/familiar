import { useMutation } from '@tanstack/react-query'
import { SignOutIcon } from '@phosphor-icons/react'
import { SignIn } from '@/components/chat/components/sign-in'
import { Button } from '@/components/ui/button'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from '@/components/ui/item'
import { useWorkspace, workspace } from '@/lib/familiar'

/**
 * The workspace's model sign-in: signed in with Sign out, or the same
 * sign-in the composer offers. Hosts that manage credentials send none.
 */
export const ModelAccount = () => {
  const account = useWorkspace((state) => state.account)
  const signOut = useMutation({
    mutationFn: () => workspace.account.signOut(),
  })

  if (account === null) {
    return (
      <p className="text-sm text-muted-foreground">
        This host manages the model's credentials itself.
      </p>
    )
  }
  if (account?.status !== 'signed-in') {
    return <SignIn className="mx-0" />
  }
  return (
    <div className="flex flex-col gap-2">
      <Item variant="outline">
        <ItemContent>
          <ItemTitle className="text-sm">Signed in to ChatGPT</ItemTitle>
          <ItemDescription>
            Every Familiar answers through your subscription.
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          <Button
            variant="outline"
            disabled={signOut.isPending}
            onClick={() => signOut.mutate()}
          >
            <SignOutIcon />
            Sign out
          </Button>
        </ItemActions>
      </Item>
      {signOut.error && (
        <p className="text-xs text-destructive">
          Couldn't sign out: {signOut.error.message}
        </p>
      )}
    </div>
  )
}
