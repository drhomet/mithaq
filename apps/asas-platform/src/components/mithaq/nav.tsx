import type { ComponentProps, CSSProperties, ReactNode } from 'react'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar'
import { titleOf, type Translate } from './copy.ts'
import { NavMain, navEntries, type AccessReport, type NavEntry, type NavKayan } from './nav-entries.tsx'
import { NavDocuments, NavSecondary } from './nav-secondary.tsx'
import { NavUserMenu, type NavUser } from './nav-user.tsx'
import { OrganizationSwitcher, type NavOrganization } from './organization-switcher.tsx'
import { ModeToggle } from './theme.tsx'

/**
 * What the header's `<h1>` says: the kayan's plural on its list, its singular on a row of it, the
 * shell's own heading anywhere else. A row is matched by the rule `NavMain` marks an entry active by.
 */
export const titleFor = ({
  entries,
  copy,
  pathname,
}: {
  entries: readonly NavEntry[]
  copy: { t: Translate; locale: string }
  pathname?: string
}): string | undefined => {
  const row = pathname === undefined ? undefined : entries.find((one) => pathname.startsWith(`${one.href}/`))
  if (row) return titleOf({ kayan: row.kayan, copy })
  const listed = entries.find((one) => one.href === pathname)
  return listed ? listed.label : copy.t('admin.nav', 'Admin')
}

export type ShellProps = {
  /** Every kayan and global the app chose to hand down, as little of each as the two keys of `NavKayan`. */
  client: readonly NavKayan[]
  access: AccessReport
  t: Translate
  locale: string
  /** Where an entry goes. A prop so the shell imports no router. */
  href: (kayan: NavKayan) => string
  /** The path the viewer is on, so the entry for it is marked current. A prop for the same reason `href` is one. */
  pathname?: string
  /** Which side the sidebar is on. */
  side?: 'left' | 'right'
  user: NavUser
  organizations: readonly NavOrganization[]
  activeOrganizationId?: string | null
  /** What switching the active organization means, which is the app's business because it is the auth arm's. */
  onSwitchOrganization: (id: string) => void
  onSignOut: () => void
  /** Where the host's permissions screen is. No row is drawn without it. */
  permissionsHref?: string
  /** Which locales the host reads in, so the user menu can offer them. A prop because mithaq resolves no locale. */
  locales?: readonly string[]
  /** What choosing a locale means. Without it the menu has no locale group. */
  onLocale?: (locale: string) => void
  children?: ReactNode
}

export function Shell({
  access,
  activeOrganizationId,
  children,
  client,
  href,
  locale,
  locales,
  onLocale,
  onSignOut,
  onSwitchOrganization,
  organizations,
  pathname,
  permissionsHref,
  side = 'left',
  t,
  user,
}: ShellProps) {
  const entries = navEntries({ client, access, copy: { t, locale }, href })
  return (
    <SidebarProvider
      style={
        {
          '--sidebar-width': 'calc(var(--spacing) * 72)',
          '--header-height': 'calc(var(--spacing) * 12)',
        } as CSSProperties
      }
    >
      <AppSidebar
        activeOrganizationId={activeOrganizationId}
        entries={entries}
        locale={locale}
        locales={locales}
        onLocale={onLocale}
        onSignOut={onSignOut}
        onSwitchOrganization={onSwitchOrganization}
        organizations={organizations}
        pathname={pathname}
        permissionsHref={permissionsHref}
        side={side}
        t={t}
        user={user}
        variant="inset"
      />
      {/* `min-w-0`: the inset is a flex item beside the sidebar, and a table wider than a phone
          would widen the whole document. */}
      <SidebarInset className="min-w-0">
        <SiteHeader t={t} title={titleFor({ entries, copy: { t, locale }, pathname })} />
        <div className="flex flex-1 flex-col px-4 pb-4 lg:px-6 lg:pb-6">
          {/* `min-w-0`: a flex child whose minimum is its content pushes the sidebar off the page
              instead of scrolling a wide table. */}
          <div className="@container/main flex min-w-0 flex-1 flex-col gap-2">{children}</div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

/**
 * The sidebar: organization switcher, kayan index and user menu. It takes `side` and no `dir`,
 * since the direction is already on the document.
 */
export function AppSidebar({
  activeOrganizationId,
  entries,
  locale,
  locales,
  onLocale,
  onSignOut,
  onSwitchOrganization,
  organizations,
  pathname,
  permissionsHref,
  t,
  user,
  ...props
}: {
  activeOrganizationId?: string | null
  entries: readonly NavEntry[]
  locale?: string
  locales?: readonly string[]
  onLocale?: (locale: string) => void
  onSignOut: () => void
  onSwitchOrganization: (id: string) => void
  organizations: readonly NavOrganization[]
  pathname?: string
  permissionsHref?: string
  t: Translate
  user: NavUser
} & ComponentProps<typeof Sidebar>) {
  return (
    <NavSidebar {...props} t={t}>
      {/* One navigation landmark around the whole sidebar. A box of its own: the sidebar's props
          reach no element on a phone, where it is a sheet. */}
      <nav aria-label={t('admin.navigation', 'Navigation')} className="flex min-h-0 flex-1 flex-col">
        <SidebarHeader>
          <OrganizationSwitcher
            activeOrganizationId={activeOrganizationId}
            onSwitch={onSwitchOrganization}
            organizations={organizations}
            t={t}
          />
        </SidebarHeader>
        <SidebarContent>
          <NavMain entries={entries} pathname={pathname} t={t} />
          <NavDocuments t={t} />
          <NavSecondary className="mt-auto" permissionsHref={permissionsHref} t={t} />
        </SidebarContent>
        <SidebarFooter>
          <NavUserMenu locale={locale} locales={locales} onLocale={onLocale} onSignOut={onSignOut} t={t} user={user} />
        </SidebarFooter>
      </nav>
    </NavSidebar>
  )
}

/**
 * `Sidebar`, except that on a phone its sheet is titled and described in the page's language;
 * the primitive's sheet is English only, which a screen reader announces on an Arabic page.
 * It has no close button: the overlay and Escape close it.
 */
export function NavSidebar({ children, side = 'left', t, ...props }: ComponentProps<typeof Sidebar> & { t: Translate }) {
  const { isMobile, openMobile, setOpenMobile } = useSidebar()
  if (!isMobile) return <Sidebar {...props} side={side} collapsible="offcanvas">{children}</Sidebar>
  return (
    <Sheet open={openMobile} onOpenChange={setOpenMobile}>
      <SheetContent
        side={side}
        showCloseButton={false}
        data-sidebar="sidebar"
        data-slot="sidebar"
        data-mobile="true"
        className="bg-sidebar text-sidebar-foreground w-(--sidebar-width) p-0"
        style={{ '--sidebar-width': '18rem' } as CSSProperties}
      >
        <SheetHeader className="sr-only">
          <SheetTitle>{t('admin.navigation', 'Navigation')}</SheetTitle>
          <SheetDescription>{t('admin.navigationAbout', 'The pages you can open.')}</SheetDescription>
        </SheetHeader>
        <div className="flex h-full w-full flex-col">{children}</div>
      </SheetContent>
    </Sheet>
  )
}

/**
 * The header: sidebar trigger, the screen's title and the theme toggle. The trigger's
 * `aria-label` is its only name, so an Arabic page carries no English word for it.
 */
export function SiteHeader({ t, title }: { t: Translate; title?: string }) {
  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger aria-label={t('admin.toggleSidebar', 'Toggle Sidebar')} className="-ms-1" />
        <Separator orientation="vertical" className="mx-2 data-[orientation=vertical]:h-4" />
        <h1 className="text-base font-medium">{title ?? t('admin.nav', 'Admin')}</h1>
        <div className="ms-auto flex items-center gap-2">
          <ModeToggle t={t} />
        </div>
      </div>
    </header>
  )
}
// mithaq-admin 18e80532b8fb462dbba313622bcd6ee8762c2c92 76b08a8f74ff36f507b21bea60b28c77d3ef7fd628c60612f29f3b51012c8f4f
