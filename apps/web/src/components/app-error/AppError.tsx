import type { ErrorComponentProps } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'

// Router errors can replace the root layout, including its safe-area spacing.
export const AppError = ({ error }: Pick<ErrorComponentProps, 'error'>) => (
  <main className="min-h-(--app-height) px-[max(1.5rem,env(safe-area-inset-left),env(safe-area-inset-right))] pt-[calc(var(--status-bar)+2rem)] pb-[calc(env(safe-area-inset-bottom)+2rem)]">
    <div className="mx-auto flex max-w-lg flex-col items-start gap-4">
      <h1 className="text-lg font-semibold">Couldn't open Familiar</h1>
      <p className="text-sm text-muted-foreground">
        Check your connection, then reload to try again.
      </p>
      <Button onClick={() => window.location.reload()}>Reload Familiar</Button>
      <details className="w-full text-sm">
        <summary className="cursor-pointer">Error details</summary>
        <pre className="mt-3 text-xs wrap-anywhere whitespace-pre-wrap">
          {error instanceof Error ? error.message : String(error)}
        </pre>
      </details>
    </div>
  </main>
)
