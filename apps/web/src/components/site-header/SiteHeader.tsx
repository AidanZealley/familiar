import { Link, useRouterState } from '@tanstack/react-router'
import { cn } from 'cn'
import {
  AlarmClockIcon,
  CatIcon,
  LibraryIcon,
  MessageSquareIcon,
  PlugIcon,
} from 'lucide-react'
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  navigationMenuTriggerStyle,
} from '@/components/ui/navigation-menu'
import { Spinner } from '@/components/ui/spinner'
import { useFamiliar } from '@/lib/familiar'
import { memorySections } from '@/lib/memory'

import { SettingsMenu } from './components/settings-menu'

const current = 'bg-muted text-foreground'

/**
 * Glass: translucent, blurring what scrolls under it, with a faint edge.
 * Its height is `--chrome`, which the root sets, so sticky parts of a page
 * can sit below it. Memory's pages are one choice away in its menu; a tap
 * opens it on a phone, as hovering does with a mouse.
 */
export const SiteHeader = () => {
  const path = useRouterState({ select: (state) => state.location.pathname })
  const connection = useFamiliar((state) => state.connection)
  const inMemory = path.startsWith('/memory')

  return (
    <header className="sticky top-0 z-30 h-(--chrome) border-b border-border/60 bg-background/80 pt-[env(safe-area-inset-top)] backdrop-blur-md">
      <div className="mx-auto flex h-full max-w-(--page-width) items-center gap-2 px-3 sm:gap-4 sm:px-4">
        <h1 className="flex items-center gap-2 font-heading text-sm font-medium tracking-tight">
          {/* In the logo's place, so the header never shifts while it reconnects. */}
          {connection === 'open' ? (
            <CatIcon className="size-5" />
          ) : (
            <Spinner
              className="size-5"
              aria-label={
                connection === 'connecting' ? 'Connecting' : 'Reconnecting'
              }
            />
          )}
          familiar
        </h1>
        <NavigationMenu align="end" className="ml-auto">
          <NavigationMenuList className="gap-1">
            <NavigationMenuItem>
              <NavigationMenuLink
                active={path === '/'}
                render={<Link to="/" />}
                className={cn(
                  navigationMenuTriggerStyle(),
                  'gap-1.5 text-muted-foreground',
                  path === '/' && current,
                )}
              >
                <MessageSquareIcon />
                <span className="max-sm:sr-only">Chat</span>
              </NavigationMenuLink>
            </NavigationMenuItem>
            <NavigationMenuItem>
              <NavigationMenuLink
                active={path === '/schedules'}
                render={<Link to="/schedules" />}
                className={cn(
                  navigationMenuTriggerStyle(),
                  'gap-1.5 text-muted-foreground',
                  path === '/schedules' && current,
                )}
              >
                <AlarmClockIcon />
                <span className="max-sm:sr-only">Schedules</span>
              </NavigationMenuLink>
            </NavigationMenuItem>
            <NavigationMenuItem>
              <NavigationMenuLink
                active={path === '/connections'}
                render={<Link to="/connections" />}
                className={cn(
                  navigationMenuTriggerStyle(),
                  'gap-1.5 text-muted-foreground',
                  path === '/connections' && current,
                )}
              >
                <PlugIcon />
                <span className="max-sm:sr-only">Connections</span>
              </NavigationMenuLink>
            </NavigationMenuItem>
            <NavigationMenuItem>
              <NavigationMenuTrigger
                className={cn(
                  'gap-1.5 text-muted-foreground max-sm:[&>svg:last-child]:hidden',
                  inMemory && current,
                )}
              >
                <LibraryIcon className="size-4" />
                <span className="max-sm:sr-only">Memory</span>
              </NavigationMenuTrigger>
              <NavigationMenuContent>
                <ul className="flex w-[min(18rem,calc(100vw-2rem))] flex-col">
                  {memorySections.map((section) => (
                    <li key={section.to}>
                      <NavigationMenuLink
                        closeOnClick
                        active={path === section.to}
                        render={<Link to={section.to} />}
                        className="items-start gap-3"
                      >
                        <section.icon className="mt-0.5" />
                        <span>
                          <span className="block font-medium">
                            {section.label}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {section.description}
                          </span>
                        </span>
                      </NavigationMenuLink>
                    </li>
                  ))}
                </ul>
              </NavigationMenuContent>
            </NavigationMenuItem>
          </NavigationMenuList>
        </NavigationMenu>
        <SettingsMenu />
      </div>
    </header>
  )
}
