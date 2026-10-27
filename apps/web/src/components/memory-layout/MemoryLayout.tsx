import { Link, Outlet } from '@tanstack/react-router'
import type { CSSProperties } from 'react'
import { memorySections } from '@/lib/memory'

/**
 * The Memory pages and the nav between them. Each page is its own route,
 * so switching starts it at the top and Back returns. The page itself
 * scrolls. On a phone the nav is a capsule docked at the bottom, within
 * reach, over a fade; wider, it floats below the header with a subtle
 * shadow. Controls a page docks above the capsule sit at `--dock`.
 */
export const MemoryLayout = () => (
  <div
    style={dock}
    className="mx-auto flex w-full max-w-5xl flex-col px-4 md:pb-[max(2rem,env(safe-area-inset-bottom))]"
  >
    {/* One nav for both places; CSS order moves it to the bottom on a phone. */}
    <div className="pointer-events-none sticky bottom-0 z-20 order-last -mx-4 -mt-8 flex justify-center bg-linear-to-t from-background via-background/80 to-transparent px-3 pt-8 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:pointer-events-auto md:top-(--chrome) md:bottom-auto md:order-none md:mt-0 md:block md:bg-none md:px-4 md:pt-2 md:pb-2">
      <nav
        aria-label="Memory"
        className="pointer-events-auto flex gap-0.5 rounded-[calc(var(--radius-md)+0.25rem)] border bg-card/90 p-1 shadow-lg shadow-black/8 backdrop-blur-md md:h-8 md:rounded-lg md:border-0 md:bg-muted/85 md:p-[3px] md:shadow-md md:shadow-black/6"
      >
        {memorySections.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact: true }}
            className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium whitespace-nowrap text-foreground/60 hover:text-foreground aria-[current=page]:bg-muted aria-[current=page]:text-foreground md:h-full md:px-1.5 md:aria-[current=page]:bg-background md:aria-[current=page]:shadow-sm [&_svg]:size-4"
          >
            <Icon />
            {label}
          </Link>
        ))}
      </nav>
    </div>

    <main className="pt-6 md:pb-8">
      <Outlet />
    </main>
  </div>
)

// The docked nav's height above the screen's bottom edge: a 2.5rem button,
// the capsule's padding and border, its bottom margin, and a small gap.
const dock = {
  '--dock':
    'calc(3.25rem + max(0.75rem, env(safe-area-inset-bottom)) + 0.375rem)',
} as CSSProperties
