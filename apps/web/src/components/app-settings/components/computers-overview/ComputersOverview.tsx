import { useQuery } from '@tanstack/react-query'
import { PixelAvatar } from '@/components/pixel-avatar'
import { StatusDot } from '@/components/status-dot'
import { Field, FieldDescription, FieldTitle } from '@/components/ui/field'
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import type { ComputerSummary } from '@familiar-ai/computer'
import { computersQuery, computerStates, describeCall } from '@/lib/computers'
import { formatAgo } from '@/lib/format'
import { nameOf, useFamiliars } from '@/lib/workspace'

/**
 * Every Familiar's computer, as the host has them: how many against the
 * limit, how many are awake, and each one's state and last use.
 */
export const ComputersOverview = () => {
  const { data, error } = useQuery(computersQuery)
  const familiars = useFamiliars()

  if (!data) {
    return (
      error && (
        <p className="text-sm text-destructive">
          Couldn't check on computers: {error.message}
        </p>
      )
    )
  }
  const { computers, max } = data
  const awake = computers.filter(({ state }) => state === 'running').length

  return (
    <Field>
      <FieldTitle>
        {max === undefined
          ? `${computers.length} ${computers.length === 1 ? 'computer' : 'computers'}`
          : `${computers.length} of ${max} computers`}
      </FieldTitle>
      <FieldDescription>
        {computers.length
          ? `${awake} awake, ${computers.length - awake} asleep.`
          : 'No Familiar has a computer yet. Give one a computer in its settings.'}
      </FieldDescription>
      {!!computers.length && (
        <ItemGroup className="gap-1.5">
          {computers.map((computer) => {
            const familiar = familiars.find(
              ({ id }) => id === computer.familiar,
            )
            const state = computerStates[computer.state]
            const when = activityOf(computer)
            return (
              <Item key={computer.familiar} variant="outline" size="xs">
                {familiar && (
                  <ItemMedia>
                    <PixelAvatar familiar={familiar} />
                  </ItemMedia>
                )}
                <ItemContent className="min-w-0">
                  <ItemTitle className="text-sm">
                    {nameOf(familiars, computer.familiar)}
                  </ItemTitle>
                  {when && (
                    <ItemDescription className="truncate">
                      {when}
                    </ItemDescription>
                  )}
                </ItemContent>
                <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                  <StatusDot tone={state.tone} />
                  {state.label}
                </span>
              </Item>
            )
          })}
        </ItemGroup>
      )}
    </Field>
  )
}

/** What a computer is doing, else when it was last used or went to sleep. */
function activityOf({ doing, lastUsed, since, state }: ComputerSummary) {
  if (doing?.length) {
    return doing.map(describeCall).join(', ')
  }
  if (lastUsed) {
    return `Last used ${formatAgo(Date.parse(lastUsed))}`
  }
  if (since) {
    return `${state === 'asleep' ? 'Went to sleep' : 'Started'} ${formatAgo(Date.parse(since))}`
  }
  return undefined
}
