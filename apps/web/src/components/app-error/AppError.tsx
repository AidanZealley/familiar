import { Problem } from '@/components/problem'
import { Button } from '@/components/ui/button'
import type { AppErrorProps } from './types'

/**
 * Familiar as a whole couldn't open: the problem, centred on the screen.
 * It replaces the root layout, so it keeps the safe areas itself.
 */
export const AppError = ({ error, description }: AppErrorProps) => (
  <main className="flex min-h-(--app-height) flex-col px-[max(1.5rem,env(safe-area-inset-left),env(safe-area-inset-right))] pt-(--status-bar) pb-[env(safe-area-inset-bottom)]">
    <Problem
      title={
        description ? "Couldn't open Familiar" : 'Familiar encountered an error'
      }
      description={description ?? 'Reload Familiar to try again.'}
      action={
        <Button onClick={() => window.location.reload()}>
          Reload Familiar
        </Button>
      }
      details={
        error === undefined
          ? undefined
          : error instanceof Error
            ? error.message
            : String(error)
      }
    />
  </main>
)
