import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { PageHeading } from '@/components/page-heading'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { memorySections } from '@/lib/memory'

/** Memory's pages, reached from the header menu, under one heading. */
export const MemoryLayout = () => {
  const path = useRouterState({ select: (state) => state.location.pathname })
  const section = memorySections.find(({ to }) => to === path)

  return (
    <main className="mx-auto flex w-full max-w-(--page-width) flex-col gap-6 px-4 pt-6 pb-[max(2rem,env(safe-area-inset-bottom))]">
      {section && (
        <div className="flex flex-col gap-2">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink render={<Link to="/memory" />}>
                  Memory
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{section.label}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <PageHeading
            title={section.label}
            description={section.description}
          />
        </div>
      )}
      <div>
        <Outlet />
      </div>
    </main>
  )
}
