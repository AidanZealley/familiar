import { useMutation, useQuery } from '@tanstack/react-query'
import { useId, useState, type FormEvent } from 'react'
import { SettingsFooter } from '@/components/settings-footer'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { queryClient } from '@/lib/familiar'
import { providerKeysQuery, setProviderKey } from '@/lib/providers'

/**
 * Model providers' API keys. Write-only: fields start empty, because the
 * daemon only says whether a provider has a key. It offers a provider's
 * models from its next start.
 */
export const ProviderKeys = () => {
  const id = useId()
  const providers = useQuery(providerKeysQuery)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const changed = Object.entries(drafts).filter(([, key]) => key.trim())
  // Each provider's new key, or null to remove it.
  const change = useMutation({
    mutationFn: async (keys: Record<string, string | null>) => {
      for (const [provider, key] of Object.entries(keys)) {
        await setProviderKey(provider, key)
      }
    },
    // Clears only the drafts this change saved, so removing one key keeps
    // another key still being typed.
    onSuccess: (_, keys) =>
      setDrafts((drafts) =>
        Object.fromEntries(
          Object.entries(drafts).filter(([provider]) => !(provider in keys)),
        ),
      ),
    // Keys saved before one failed are still saved, so refresh anyway.
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: providerKeysQuery.queryKey }),
  })

  if (providers.data === null) {
    return (
      <p className="text-sm text-muted-foreground">
        This host manages its models' credentials itself.
      </p>
    )
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    change.mutate(
      Object.fromEntries(
        changed.map(([provider, key]) => [provider, key.trim()]),
      ),
    )
  }

  return (
    <form onSubmit={submit} className="flex flex-1 flex-col">
      <FieldGroup className="flex-1 gap-6">
        {providers.data?.map((provider) => (
          <Field key={provider.id}>
            <FieldLabel htmlFor={`${id}-${provider.id}`}>
              {provider.name}
              <Badge variant={provider.set ? 'secondary' : 'outline'}>
                {provider.set ? 'Set' : 'Not set'}
              </Badge>
            </FieldLabel>
            <div className="flex gap-2">
              <Input
                id={`${id}-${provider.id}`}
                type="password"
                // Keeps the browser from filling in a saved password.
                autoComplete="new-password"
                spellCheck={false}
                placeholder={
                  provider.set ? 'Enter a new one to replace it' : ''
                }
                value={drafts[provider.id] ?? ''}
                onChange={(event) =>
                  setDrafts({ ...drafts, [provider.id]: event.target.value })
                }
              />
              {provider.set && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={change.isPending}
                  onClick={() => change.mutate({ [provider.id]: null })}
                >
                  Remove
                </Button>
              )}
            </div>
          </Field>
        ))}
        <FieldDescription>
          Kept encrypted on this host and sent only to their provider. A change
          applies when Familiar restarts.
        </FieldDescription>
        <FieldError>
          {providers.error?.message ?? change.error?.message}
        </FieldError>
        <SettingsFooter
          canSave={changed.length > 0 && !change.isPending}
          onDiscard={changed.length ? () => setDrafts({}) : undefined}
        />
      </FieldGroup>
    </form>
  )
}
