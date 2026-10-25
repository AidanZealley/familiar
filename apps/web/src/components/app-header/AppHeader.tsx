import { Link } from '@tanstack/react-router'
import { useFamiliar } from '@/lib/familiar'

const linkClass =
  'text-sm text-muted-foreground data-[status=active]:text-foreground'

export const AppHeader = () => {
  const connection = useFamiliar((state) => state.connection)

  return (
    <header className="flex items-center gap-4 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-3">
      <h1 className="font-medium">Familiar</h1>
      <nav className="flex gap-3">
        <Link to="/" className={linkClass}>
          Chat
        </Link>
        <Link to="/memory" className={linkClass}>
          Memory
        </Link>
      </nav>
      {connection !== 'open' && (
        <span className="ml-auto text-xs text-muted-foreground">
          {connection === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
        </span>
      )}
    </header>
  )
}
