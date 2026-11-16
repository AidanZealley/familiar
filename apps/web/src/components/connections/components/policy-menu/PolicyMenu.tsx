import type { Policy } from '@familiar-ai/client'
import { CaretDownIcon } from '@phosphor-icons/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { workspace } from '@/lib/familiar'
import { cn } from 'cn'
import { connectionsQuery } from '../../query'
import type { PolicyMenuProps } from './types'

const POLICY_LABELS: Record<Policy, string> = {
  allow: 'Runs',
  ask: 'Asks first',
  deny: 'Off',
}

const DEFAULT = 'default'

/**
 * Whether a connection's tool, or all of them, runs when a Familiar calls
 * it, asks the person first, or never runs. The owner's choice, or back to
 * the default.
 */
export const PolicyMenu = ({
  connection,
  tool,
  policy,
  fallback,
}: PolicyMenuProps) => {
  const queryClient = useQueryClient()
  const set = useMutation({
    mutationKey: ['connections'],
    mutationFn: (next: Policy | null) =>
      workspace.connections.setPolicy(
        { kind: connection.kind, name: connection.name },
        tool,
        next,
      ),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: connectionsQuery.queryKey }),
  })
  const shown = policy ?? fallback
  const defaultLabel = fallback
    ? `Default: ${POLICY_LABELS[fallback].toLowerCase()}`
    : 'By each tool’s hints'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="xs"
            disabled={set.isPending}
            aria-label={`When ${tool ?? `${connection.title}'s tools`} run`}
            className={cn(!policy && 'text-muted-foreground')}
          />
        }
      >
        {shown ? POLICY_LABELS[shown] : 'Per tool'}
        <CaretDownIcon data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>
          {tool ? 'When a Familiar calls it' : 'For every tool without its own'}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={policy ?? DEFAULT}
          onValueChange={(value: string) =>
            set.mutate(value === DEFAULT ? null : (value as Policy))
          }
        >
          {(['allow', 'ask', 'deny'] as const).map((value) => (
            <DropdownMenuRadioItem key={value} value={value}>
              {POLICY_LABELS[value]}
            </DropdownMenuRadioItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuRadioItem value={DEFAULT}>
            {defaultLabel}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
