// The frame both screens may put at the root of a page: a collapsible sidebar holding the organization switcher, the nav and the user menu, and an inset holding the site header over the page.
// A row that goes nowhere is not drawn, so there are no quick-create or inbox buttons, documents group, or help and search rows: none has a destination in this template.
import { use, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import {
  ArrowUpRight,
  BookOpen,
  Building2,
  CalendarDays,
  ClipboardList,
  History,
  LayoutDashboard,
  Settings2,
  ShieldCheck,
  Table2,
  Tags,
  UserCog,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react'
import type { ShellProps } from 'mithaq/admin'
import { ScreenContext, useLocale, useNav, useScreen, useUser } from 'mithaq/admin/react'
import { authArm } from '@/api.ts'
import { locales, switchLocale } from '@/copy.ts'
import { PageHeader } from 'mithaq-admin/page-header.tsx'
import { DiscardDialog } from 'mithaq-admin/discard-dialog.tsx'
import { NavSidebar } from 'mithaq-admin/nav.tsx'
import { NavUserMenu } from 'mithaq-admin/nav-user.tsx'
import { OrganizationSwitcher, type NavOrganization } from 'mithaq-admin/organization-switcher.tsx'
import { buttonVariants } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { navLabel } from './screen-nav.tsx'
import { nameIn, showOrganization } from '../mithaq/auth/organizations.ts'

export const regions = ['header', 'primary', 'more', 'main'] as const

/** One icon per nav entry, keyed by the entry's path under the screen, and `Table2` for any other. */
const icons: Record<string, LucideIcon> = {
  '/': LayoutDashboard,
  '/users': UserRound,
  '/organizations': Building2,
  '/members': Users,
  '/courses': BookOpen,
  '/sessions': CalendarDays,
  '/enrollments': ClipboardList,
  '/tags': Tags,
  '/roles': ShieldCheck,
  '/member-roles': UserCog,
  '/settings': Settings2,
  '/activity': History,
  '/history': History,
}
export const iconOf = (path: string) => (Object.hasOwn(icons, path) ? icons[path]! : Table2)

/**
 * The path the browser is on. The server has no location, so nothing is
 * marked current in the first paint and the entry is marked once it hydrates.
 */
const usePathname = () => useSyncExternalStore(() => () => {}, () => window.location.pathname, () => undefined)

/**
 * The locale switch and sign-out, in the user menu. The locale is a cookie and a reload, because the request middleware reads it before any route runs;
 * the switch is asked first, in the app's discard dialog, where a form holds a change nobody saved.
 */
export function UserMenu() {
  const { locale, t } = useLocale()
  // The language asked for while a form holds a change nobody saved, which the
  // app's own discard dialog confirms in the page's words.
  const [asked, setAsked] = useState<string>()
  return (
    <>
      <NavUserMenu
        user={useUser()}
        t={t}
        locale={locale}
        locales={locales}
        onLocale={(next) => (window.onbeforeunload ? setAsked(next) : switchLocale({ to: next }))}
        // Only once the provider has answered: its sign-out answers 200 with a
        // session or without one, so a refusal stays where it is. `replace`,
        // so Back does not return to the page signed out of. The sign-out that
        // ends an impersonation answers the backoffice's address, where the staff
        // member goes next.
        onSignOut={() => void authArm('sign-out').then((answer) => answer.ok && window.location.replace(String(answer.body?.url ?? '/auth/sign-in')))}
      />
      <DiscardDialog open={asked !== undefined} onOpenChange={(open) => !open && setAsked(undefined)} onDiscard={() => switchLocale({ to: asked! })} t={t} />
    </>
  )
}

/**
 * The organization switcher over the organizations the session came with. The host sends them with the session, so it is drawn with the page and never flashes a skeleton.
 * Switching reloads the page, because every loader reads its rows under the active organization on the server.
 */
function Organizations() {
  const { locale, t } = useLocale()
  const { organizations = [], activeOrganizationId } = useUser()
  return (
    <OrganizationSwitcher
      organizations={organizations.map((one) => ({ ...one, name: nameIn(one, locale) }))}
      activeOrganizationId={activeOrganizationId}
      t={t}
      onSwitch={(organizationId) => void authArm('organization/set-active', { organizationId }).then((answer) => answer.ok && window.location.reload())}
    />
  )
}

/**
 * One entry per destination, the shell's own first and the entities after.
 * The dashboard is current on its own path alone; every other entry on its path and below it.
 */
function NavMain({ home }: { home?: string }) {
  const { locale, t } = useLocale()
  const screen = useScreen()
  const pathname = usePathname()
  const entries = [
    { path: '/', page: 'home', label: { [locale]: home ?? t('dashboard.dashboard', 'Dashboard') ?? 'Dashboard' } },
    ...useNav().filter((entry) => !entry.hidden),
  ]
  const groups: (typeof entries)[] = []
  for (const entry of entries) {
    const group = groups.find((one) => one[0]!.group?.name === entry.group?.name)
    if (group) group.push(entry)
    else groups.push([entry])
  }
  return groups.map((group) => (
    <SidebarGroup key={group[0]!.group?.name ?? ''} data-nav-group={group[0]!.group?.name} data-nav-position={group[0]!.group?.position} className={group[0]!.group?.position === 'bottom' ? 'mt-auto' : undefined}>
      {group[0]!.group ? <SidebarGroupLabel>{group[0]!.group!.label[locale]}</SidebarGroupLabel> : null}
      <SidebarGroupContent>
        <SidebarMenu>
          {group.map((entry) => {
            const href = entry.path === '/' ? screen.path : `${screen.path}${entry.path}`
            const Icon = iconOf(entry.path)
            const isActive = pathname !== undefined && (pathname === href || (entry.path !== '/' && pathname.startsWith(`${href}/`)))
            return (
              <SidebarMenuItem key={entry.path}>
                <SidebarMenuButton
                  isActive={isActive}
                  className="min-h-11 md:min-h-0"
                  render={<a href={href} aria-current={isActive ? 'page' : undefined}><Icon /><span>{navLabel({ entry, screen, locale, t })}</span></a>}
                />
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  ))
}

export const frame = { '--sidebar-width': 'var(--app-sidebar-width, calc(var(--spacing) * 72))', '--header-height': 'calc(var(--spacing) * 12)' } as CSSProperties

/**
 * The site header's bar, with the page's own title. It is sticky: its trigger is the only way back to a hidden sidebar, so it stays on screen however far the page is scrolled.
 * Below sm the title may take two lines, set tight so both fit the bar, since on a phone it is often the record's only name; from sm up it is one line, cut at its end.
 * From sm up the row wraps and the bar grows with it, so a form's controls that do not fit take a line of their own rather than run over the title or past the bar's end.
 * A bar that wrapped is taller than `--header-height`, so it measures itself into `--header-bar-height`, which what sticks under it reads.
 */
export const headerBar = 'sticky top-0 z-10 bg-background rounded-t-[inherit] flex min-h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:min-h-(--header-height)'
export const headerRow = 'flex w-full min-w-0 items-center gap-1 px-4 sm:flex-wrap sm:gap-y-2 sm:py-2 lg:gap-2 lg:px-6 [&_h1]:min-w-0 [&_h1]:line-clamp-2 [&_h1]:leading-tight [&_h1]:wrap-break-word sm:[&_h1]:line-clamp-none sm:[&_h1]:leading-normal sm:[&_h1]:wrap-normal sm:[&_h1]:truncate [&_h1]:text-base [&_h1]:font-medium [&_h1]:tracking-normal'

/**
 * The header's own height on the document, as `--header-bar-height`, kept while the header is on screen and taken off with it.
 * A variable of its own and never `--header-height`, which the bar's `min-h-(--header-height)` reads, so the measure would feed itself.
 * A module function, so React hands the ref the same callback on every render and observes the header once.
 */
const measureHeader = (header: HTMLElement | null) => {
  if (!header) return
  const root = document.documentElement.style
  // `borderBoxSize` is missing before Safari 15.4, so the header's own `offsetHeight` stands in there.
  const observer = new ResizeObserver(([entry]) => {
    if (entry) root.setProperty('--header-bar-height', `${entry.borderBoxSize?.[0]?.blockSize ?? (entry.target as HTMLElement).offsetHeight}px`)
  })
  observer.observe(header)
  return () => {
    observer.disconnect()
    root.removeProperty('--header-bar-height')
  }
}

/**
 * The one way from a tenant screen to the backoffice app, in the header, for an actor whose own `user.role` holds a backoffice role that enters it.
 * The link grants nothing here: the backoffice app's own server decides entry.
 * Below xl it is its icon alone, a 44 pixel square on a phone, its words kept for a screen reader, so the page's title keeps the header's width.
 * A quiet ghost button at the row's end, so the page's own actions beside the title lead.
 */
export function BackofficeLink() {
  const { t } = useLocale()
  const backoffice = useUser().screens?.find((one) => one.name === 'backoffice')
  if (!backoffice) return null
  return (
    <a href={backoffice.path} data-backoffice-link="" className={buttonVariants({ variant: 'ghost', size: 'sm', className: 'text-muted-foreground ms-auto min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 px-0 sm:px-2.5 xl:px-3 [[data-node=controls]:not(:empty)~&]:ms-0' })}>
      <span className="sr-only xl:not-sr-only">{t('dashboard.openBackoffice', 'Open the backoffice')}</span>
      <ArrowUpRight data-icon="inline-end" className="rtl:-scale-x-100" />
    </a>
  )
}

/** The sidebar on the side the document's direction starts from. */
export function AppShell({ regions: content, backoffice = false, brand, home, page, breadcrumb: ownBreadcrumb }: ShellProps<typeof regions, ReactNode> & { backoffice?: boolean; brand?: ReactNode; home?: string; page?: { path: string }; breadcrumb?: { href: string; label: string } }) {
  const { dir, t } = useLocale()
  const state = use(ScreenContext)
  const list = state?.kayan?.pages.list
  const listed = state?.screen.nav.some((entry) => entry.kayan === state.kayan?.name)
  const breadcrumb = ownBreadcrumb ?? (page && list && listed && page.path !== list.path ? {
    href: `${state!.screen.path}${list.path}`,
    label: t(`${state!.kayan!.name}.plural`, state!.kayan!.name) ?? state!.kayan!.name,
  } : undefined)
  return (
    <SidebarProvider data-shell="app" style={frame}>
      <NavSidebar variant="inset" side={dir === 'rtl' ? 'right' : 'left'} t={t}>
        {/* One navigation landmark around the whole sidebar, named in the
            page's language, so the switcher and the user menu are inside a
            landmark as the links are. It is a box of its own and not a role on
            the sidebar, whose props reach no element on a phone, where it is a
            sheet. */}
        <nav aria-label={t('admin.navigation', 'Navigation')} className="flex min-h-0 flex-1 flex-col">
          {/* With no organization shown, the app's own name sits where the switcher would. */}
          <SidebarHeader>{brand ?? (!showOrganization ? <span data-brand="" className="truncate px-2 py-1.5 text-base font-semibold">{t('marketing.brand', 'Asas')}</span> : <Organizations />)}</SidebarHeader>
          <SidebarContent>
            <NavMain home={home} />
          </SidebarContent>
          <SidebarFooter>
            <UserMenu />
          </SidebarFooter>
        </nav>
      </NavSidebar>
      {/* `min-w-0` so the inset, a flex item beside the sidebar, never takes
          the width of the widest thing a page holds: without it a table wider
          than a phone would widen the document, header and trigger with it. A
          wide table scrolls in its own frame instead. */}
      <SidebarInset className="min-w-0">
        <header data-region="header" ref={measureHeader} className={headerBar}>
          <div data-header-row="" className={headerRow}>
            <SidebarTrigger aria-label={t('admin.toggleSidebar', 'Toggle Sidebar')} className="-ms-1 min-h-11 min-w-11 md:min-h-0 md:min-w-0" />
            <Separator orientation="vertical" className="mx-2 data-[orientation=vertical]:h-4" />
            {backoffice ? <>{content.header}{content.primary}{content.more}</> : (
              <PageHeader t={t} breadcrumb={breadcrumb} primary={content.primary} more={content.more}>{content.header}</PageHeader>
            )}
            <BackofficeLink />
          </div>
        </header>
        <div data-page-body="" className="flex min-w-0 flex-1 flex-col px-4 py-4 lg:px-6">
          {/* `min-w-0` so a table wider than the page scrolls rather than
              pushing the sidebar off it. A div and not a `main`, because the
              inset around it is already the page's one main landmark. */}
          <div data-region="main" className="@container/main flex min-w-0 flex-1 flex-col gap-2">{content.main}</div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

/**
 * The backoffice's frame, the dashboard's with two changes: the app's name where the organization switcher sits, since staff work above every organization and switch to none of them,
 * and the home entry named as its page names itself, so the nav and the page say one word.
 */
export function BackofficeShell(props: ShellProps<typeof regions, ReactNode>) {
  const { t } = useLocale()
  return (
    <AppShell
      {...props}
      backoffice
      brand={<span data-brand="" className="truncate px-2 py-1.5 text-base font-semibold">{t('backoffice.brand', 'Asas backoffice')}</span>}
      home={t('backoffice.title', 'Backoffice')}
    />
  )
}
