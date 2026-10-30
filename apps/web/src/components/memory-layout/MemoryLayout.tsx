import { Outlet, useRouterState } from '@tanstack/react-router'
import { PageHeading } from '@/components/page-heading'
import { memorySections } from '@/lib/memory'

/** Memory's pages, reached from the header menu, under one heading. */
export const MemoryLayout = () => {
  const path = useRouterState({ select: (state) => state.location.pathname })
  const section = memorySections.find(({ to }) => to === path)

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 pt-6 pb-[max(2rem,env(safe-area-inset-bottom))]">
      {section && (
        <PageHeading
          title="Memory"
          section={section.label}
          description={section.description}
        />
      )}
      <div>
        <Outlet />
      </div>
    </main>
  )
}
