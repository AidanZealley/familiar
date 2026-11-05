import { Link, useRouterState } from '@tanstack/react-router'
import { cn } from 'cn'
import {
  AlarmClockIcon,
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
import { memorySections } from '@/lib/memory-sections'
import { ConnectionStatus } from './components/connection-status'
import { SettingsMenu } from './components/settings-menu'

const pages = [
  { to: '/', label: 'Chat', icon: MessageSquareIcon },
  { to: '/schedules', label: 'Schedules', icon: AlarmClockIcon },
  { to: '/connections', label: 'Connections', icon: PlugIcon },
] as const

const current = 'bg-muted text-foreground'

/**
 * Glass: translucent, blurring what scrolls under it, with a faint edge.
 * Its height is `--chrome`, so sticky parts of a page can sit below it.
 * Memory's pages are one choice away in its menu; a tap opens it on a
 * phone, as hovering does with a mouse.
 */
export const SiteHeader = () => {
  const path = useRouterState({ select: (state) => state.location.pathname })

  return (
    <header className="sticky top-0 z-30 h-(--chrome) border-b border-border/60 bg-background/80 pt-(--status-bar) backdrop-blur-md">
      <div className="mx-auto flex h-full max-w-(--page-width) items-center gap-2 px-3 sm:gap-4 sm:px-4">
        <h1 className="flex items-center gap-2 font-heading text-sm font-medium tracking-tight">
          {/* In the logo's place, so the header never shifts while it reconnects. */}
          <ConnectionStatus />
          familiar
        </h1>
        <NavigationMenu align="end" className="ml-auto">
          <NavigationMenuList className="gap-1">
            {pages.map(({ to, label, icon: Icon }) => (
              <NavigationMenuItem key={to}>
                <NavigationMenuLink
                  active={path === to}
                  render={<Link to={to} />}
                  className={cn(
                    navigationMenuTriggerStyle(),
                    'gap-1.5 text-muted-foreground data-active:bg-muted data-active:text-foreground',
                  )}
                >
                  <Icon />
                  <span className="max-sm:sr-only">{label}</span>
                </NavigationMenuLink>
              </NavigationMenuItem>
            ))}
            <NavigationMenuItem>
              <NavigationMenuTrigger
                className={cn(
                  'gap-1.5 text-muted-foreground max-sm:[&>svg:last-child]:hidden',
                  // A trigger, not a link, so it has no active state of its own.
                  path.startsWith('/memory') && current,
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
