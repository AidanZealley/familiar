import type { HealthTileProps } from './types'

export const HealthTile = ({ label, value, children }: HealthTileProps) => (
  <section className="flex flex-col gap-1 rounded-xl border bg-card p-4">
    <h2 className="text-sm text-muted-foreground">{label}</h2>
    <p className="font-heading text-3xl font-semibold">{value}</p>
    <div className="mt-auto flex flex-col gap-1.5 pt-1 text-xs text-muted-foreground">
      {children}
    </div>
  </section>
)
