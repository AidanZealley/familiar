import { Link, Outlet } from '@tanstack/react-router'
import { memorySections } from '@/lib/memory'

/** Memory sections stay in the header menu on phones, with tabs on desktop. */
export const MemoryLayout = () => (
  <div className="mx-auto flex w-full max-w-5xl flex-col px-4 pb-[max(2rem,env(safe-area-inset-bottom))]">
    <div className="sticky top-(--chrome) z-20 -mx-4 hidden px-4 py-2 md:block">
      <nav
        aria-label="Memory"
        className="flex h-8 gap-0.5 rounded-lg bg-muted/85 p-[3px] shadow-md shadow-black/6 backdrop-blur-md"
      >
        {memorySections.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact: true }}
            className="flex h-full flex-1 items-center justify-center gap-1.5 rounded-md px-1.5 text-sm font-medium whitespace-nowrap text-foreground/60 hover:text-foreground aria-[current=page]:bg-background aria-[current=page]:text-foreground aria-[current=page]:shadow-sm [&_svg]:size-4"
          >
            <Icon />
            {label}
          </Link>
        ))}
      </nav>
    </div>

    <main className="pt-6">
      <Outlet />
    </main>
  </div>
)
