import { useMutation } from '@tanstack/react-query'
import { SignOutIcon } from '@phosphor-icons/react'
import { SignIn } from '@/components/chat/components/sign-in'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldTitle } from '@/components/ui/field'
import { useWorkspace, workspace } from '@/lib/familiar'

/**
 * OpenAI, reached through the workspace's ChatGPT sign-in: signed in with
 * Sign out, or the same sign-in the composer offers. Nothing when the host
 * reaches its models another way and sends no account.
 */
export const OpenaiSignIn = () => {
  const account = useWorkspace((state) => state.account)
  const signOut = useMutation({
    mutationFn: () => workspace.account.signOut(),
  })

  if (account === null) {
    return null
  }
  const signedIn = account?.status === 'signed-in'
  return (
    <Field>
      <FieldTitle>
        OpenAI
        <Badge variant={signedIn ? 'secondary' : 'outline'}>
          {signedIn ? 'Signed in' : 'Not signed in'}
        </Badge>
      </FieldTitle>
      {signedIn ? (
        <div className="flex items-center justify-between gap-2">
          <FieldDescription>
            Through your ChatGPT subscription.
          </FieldDescription>
          <Button
            variant="outline"
            disabled={signOut.isPending}
            onClick={() => signOut.mutate()}
          >
            <SignOutIcon />
            Sign out
          </Button>
        </div>
      ) : (
        <SignIn className="mx-0" />
      )}
      {signOut.error && (
        <p className="text-xs text-destructive">
          Couldn't sign out: {signOut.error.message}
        </p>
      )}
    </Field>
  )
}
