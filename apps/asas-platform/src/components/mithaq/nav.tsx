import { createContext, useContext, useEffect, useMemo, useState, type ComponentProps, type CSSProperties, type ReactNode } from 'react'
import {
  BookOpen,
  Building2,
  CalendarDays,
  Check,
  ChevronsUpDown,
  ClipboardList,
  Folder,
  GalleryVerticalEnd,
  HelpCircle,
  Languages,
  LayoutGrid,
  LogOut,
  Mail,
  Monitor,
  Moon,
  MoreHorizontal,
  PlusCircle,
  Search,
  Settings2,
  Share2,
  ShieldCheck,
  Sun,
  Table2,
  Trash2,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { Moon02Icon, Sun03Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import type { ClientKayan } from 'mithaq/admin'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar'
import { titleOf, type Translate } from './copy.ts'

/**
 * As much of the access report as this screen reads: one `read` per kayan, keyed by its name.
 * `operations` is what a screen gates a control on: an effect is allowed where any one of its
 * operations is, so gate a button on `operations.archive`, never on the effect.
 */
export type AccessReport = {
  readonly collections?: Readonly<
    Record<
      string,
      { readonly read?: boolean; readonly operations?: Readonly<Record<string, boolean>> } | undefined
    >
  >
}

/**
 * The two keys of a kayan this screen reads: its name, and whether it is a global, which picks the
 * singular over the plural. A shell handed only these server-renders no field names or labels.
 */
export type NavKayan = Pick<ClientKayan, 'name' | 'single'>

/**
 * One lucide icon per common kayan name, `Table2` for every other kayan. An app gives its own
 * kayan an icon by editing this map.
 */
export const navIcons: Record<string, LucideIcon> = {
  courses: BookOpen,
  sessions: CalendarDays,
  enrollments: ClipboardList,
  settings: Settings2,
  user: Users,
  localUsers: Users,
  member: Users,
  organization: Building2,
  invitation: Mail,
  roles: ShieldCheck,
}

/** The icon a kayan is listed under. `Object.hasOwn` so a kayan named for a key of `Object.prototype` reads nothing off it. */
export const iconOf = (name: string): LucideIcon => (Object.hasOwn(navIcons, name) ? navIcons[name]! : Table2)

/** One entry of the kayan index: what it is called, where it goes and what it is drawn with. */
export type NavEntry = { kayan: NavKayan; label: string; href: string; Icon: LucideIcon }

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

/** The kayan index: the kayans this request's access report lets the viewer read. */
export const navEntries = ({
  client,
  access,
  copy,
  href,
}: {
  client: readonly NavKayan[]
  access: AccessReport
  copy: { t: Translate; locale: string }
  href: (kayan: NavKayan) => string
}): NavEntry[] =>
  client
    // `=== true` so a kayan the report has no entry for is denied, including one named for a key
    // of `Object.prototype`.
    .filter((kayan) => access.collections?.[kayan.name]?.read === true)
    .map((kayan) => ({
      kayan,
      label: titleOf({ kayan, copy, many: !kayan.single }),
      href: href(kayan),
      Icon: iconOf(kayan.name),
    }))

/** The values the theme toggle offers. */
export type Theme = 'dark' | 'light' | 'system'

/** The themes the user menu offers unless the project passes its own to `NavUserMenu`. */
export const defaultThemes: readonly Theme[] = ['light', 'dark', 'system']

type ThemeProviderProps = {
  children: ReactNode
  defaultTheme?: Theme
  storageKey?: string
}

type ThemeProviderState = {
  theme: Theme
  setTheme: (theme: Theme) => void
}

const initialState: ThemeProviderState = {
  theme: 'system',
  setTheme: () => null,
}

/** `null` outside a provider, so a menu that offers the choice draws nothing where nothing would keep it. */
const ThemeProviderContext = createContext<ThemeProviderState | null>(null)

/**
 * Keeps the theme in `localStorage` and puts `light` or `dark` on the document element. The stored
 * theme is read in the first browser render and not in an effect: a change after mount re-renders
 * consumers, and inside an unhydrated Suspense boundary that makes React drop the server's HTML.
 */
export function ThemeProvider({
  children,
  defaultTheme = 'system',
  storageKey = 'vite-ui-theme',
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === 'undefined') return defaultTheme
    const stored = localStorage.getItem(storageKey)
    // A stray value under this key would hydrate mismatched against the server's default.
    return stored === 'dark' || stored === 'light' || stored === 'system' ? stored : defaultTheme
  })

  useEffect(() => {
    const root = window.document.documentElement
    root.classList.remove('light', 'dark')

    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      root.classList.add(systemTheme)
      return
    }

    root.classList.add(theme)
  }, [theme])

  const value = useMemo(
    () => ({
      theme,
      setTheme: (newTheme: Theme) => {
        localStorage.setItem(storageKey, newTheme)
        setTheme(newTheme)
      },
    }),
    [theme, storageKey],
  )

  return <ThemeProviderContext.Provider value={value}>{children}</ThemeProviderContext.Provider>
}

/** The theme and its setter, or `null` where no `ThemeProvider` is above. */
export const useTheme = () => useContext(ThemeProviderContext)

/** A theme toggle button whose menu offers light, dark and system. */
export function ModeToggle({ t }: { t: Translate }) {
  const { setTheme } = useTheme() ?? initialState

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={buttonVariants({ variant: 'outline', size: 'icon' })}>
        <HugeiconsIcon
          icon={Sun03Icon}
          className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0"
        />
        <HugeiconsIcon
          icon={Moon02Icon}
          className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100"
        />
        <span className="sr-only">{t('admin.theme', 'Toggle theme')}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-sm:**:data-[slot$=item]:min-h-11">
        <DropdownMenuItem onClick={() => setTheme('light')}>{t('admin.themeLight', 'Light')}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('dark')}>{t('admin.themeDark', 'Dark')}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('system')}>
          {t('admin.themeSystem', 'System')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * A language's own name for itself (`ar` reads `العربية`), whatever the viewer reads in. It is the
 * same in every locale, so it carries no copy key. `of` throws a `RangeError` on a malformed tag,
 * so the tag itself is the fallback.
 */
export const endonym = (locale: string): string => {
  try {
    return new Intl.DisplayNames([locale], { type: 'language' }).of(locale) ?? locale
  } catch {
    return locale
  }
}

/** A radio row: a 44 pixel target on a phone, and the tick on the inline end in right-to-left pages, where the primitive draws it at the right. */
const radioRow = 'max-sm:min-h-11 rtl:pr-3 rtl:pl-8 rtl:[&>[data-slot=dropdown-menu-radio-item-indicator]]:right-auto rtl:[&>[data-slot=dropdown-menu-radio-item-indicator]]:left-2'

/** One row of the user menu's locale group: the locale, what it calls itself, and whether it is the one being read in. */
export const localeEntries = (
  locales: readonly string[],
  current: string,
): readonly { locale: string; label: string; active: boolean }[] =>
  locales.map((one) => ({ locale: one, label: endonym(one), active: one === current }))

/** What the shell is told about the viewer, which is the two strings the user menu draws. */
export type NavUser = {
  name: string
  email: string
  /** The other screens the host links for this viewer, each a whole address; the user menu draws a link to each. */
  screens?: readonly { name: string; path: string }[]
}

/**
 * One organization the switcher lists. Two may share a name, so each carries a slug, which the
 * switcher shows beside a name that repeats.
 */
export type NavOrganization = { id: string; name: string; slug?: string }

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
 * The kayan index as one sidebar group. An entry is current when the path is its own or a segment
 * under it, so no two entries are current at once. `render` and not `asChild`: base-ui composes a
 * button into an anchor through `useRender`.
 */
export function NavMain({ entries, pathname, t }: { entries: readonly NavEntry[]; pathname?: string; t: Translate }) {
  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-2">
        {/* Quick Create and Inbox are placeholders: this admin has no destination for either. */}
        <SidebarMenu>
          <SidebarMenuItem className="flex items-center gap-2">
            <SidebarMenuButton
              tooltip={t('admin.quickCreate', 'Quick Create')}
              className="bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground min-w-8 duration-200 ease-linear"
            >
              <PlusCircle />
              <span>{t('admin.quickCreate', 'Quick Create')}</span>
            </SidebarMenuButton>
            <Button size="icon" className="size-8 group-data-[collapsible=icon]:opacity-0" variant="outline">
              <Mail />
              <span className="sr-only">{t('admin.inbox', 'Inbox')}</span>
            </Button>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarMenu>
          {entries.map((entry) => {
            const isActive = pathname !== undefined && (pathname === entry.href || pathname.startsWith(`${entry.href}/`))
            return (
              <SidebarMenuItem key={entry.kayan.name}>
                <SidebarMenuButton
                  isActive={isActive}
                  render={
                    <a href={entry.href}>
                      <entry.Icon />
                      <span>{entry.label}</span>
                    </a>
                  }
                />
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

/**
 * The documents group. `items` defaults to none, so only the label and the "More" row draw; the
 * row markup stays for an app that passes its own documents.
 */
export function NavDocuments({
  items = [],
  t,
}: {
  items?: readonly { name: string; url: string; icon: LucideIcon }[]
  t: Translate
}) {
  const { isMobile } = useSidebar()
  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>{t('admin.documents', 'Documents')}</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => (
          <SidebarMenuItem key={item.name}>
            <SidebarMenuButton render={<a href={item.url} />}>
              <item.icon />
              <span>{item.name}</span>
            </SidebarMenuButton>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={(props) => (
                  <SidebarMenuAction showOnHover className="data-[state=open]:bg-accent rounded-sm" {...props}>
                    <MoreHorizontal />
                    <span className="sr-only">{t('admin.more', 'More')}</span>
                  </SidebarMenuAction>
                )}
              />
              <DropdownMenuContent
                className="w-24 rounded-lg"
                side={isMobile ? 'bottom' : 'right'}
                align={isMobile ? 'end' : 'start'}
              >
                <DropdownMenuItem>
                  <Folder className="me-2 h-4 w-4" />
                  <span>{t('admin.open', 'Open')}</span>
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Share2 className="me-2 h-4 w-4" />
                  <span>{t('admin.share', 'Share')}</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive">
                  <Trash2 className="me-2 h-4 w-4" />
                  <span>{t('admin.trash', 'Move to Trash')}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        ))}
        <SidebarMenuItem>
          <SidebarMenuButton className="text-sidebar-foreground/70">
            <MoreHorizontal className="text-sidebar-foreground/70" />
            <span>{t('admin.more', 'More')}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  )
}

/**
 * The rows at the foot of the sidebar: a permissions row where the host gives `permissionsHref`,
 * then Get Help and Search, which point at `#`. Their copy keys are quoted literals at the call
 * so the copy sweep can see them.
 */
export function NavSecondary({
  className,
  permissionsHref,
  t,
}: {
  className?: string
  permissionsHref?: string
  t: Translate
}) {
  return (
    <SidebarGroup className={className}>
      <SidebarGroupContent>
        <SidebarMenu>
          {permissionsHref ? (
            <SidebarMenuItem>
              <SidebarMenuButton render={<a href={permissionsHref} />}>
                <ShieldCheck />
                <span>{t('admin.permissions', 'Permissions')}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : null}
          <SidebarMenuItem>
            <SidebarMenuButton render={<a href="#" />}>
              <HelpCircle />
              <span>{t('admin.getHelp', 'Get Help')}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton render={<a href="#" />}>
              <Search />
              <span>{t('admin.search', 'Search')}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('') || '?'

/**
 * The organization switcher: a dropdown listing every organization as a radio item, the active
 * one checked.
 */
export function OrganizationSwitcher({
  activeOrganizationId,
  onSwitch,
  organizations,
  t,
}: {
  activeOrganizationId?: string | null
  onSwitch: (id: string) => void
  organizations: readonly NavOrganization[]
  t: Translate
}) {
  const { isMobile } = useSidebar()
  const active = organizations.find((one) => one.id === activeOrganizationId) ?? organizations[0]
  /** An organization's name, with its slug beside it where another listed shares the name. */
  const named = (one: NavOrganization) =>
    one.slug && organizations.some((other) => other.id !== one.id && other.name === one.name) ? (
      <>
        {one.name} <span dir="ltr" data-slug="" className="text-muted-foreground text-xs font-normal">{one.slug}</span>
      </>
    ) : (
      one.name
    )
  const badge = (
    <>
      <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
        <GalleryVerticalEnd className="size-4" />
      </div>
      <div className="grid flex-1 text-start text-sm leading-tight">
        <span className="truncate font-semibold text-foreground">
          {active ? named(active) : t('admin.noOrganization', 'No organization')}
        </span>
        <span className="truncate text-xs">
          {active ? t('admin.organization', 'Organization') : ''}
        </span>
      </div>
    </>
  )
  // One organization or none is nothing to switch between, so it is drawn as a plain name.
  if (organizations.length < 2) {
    return (
      <SidebarMenu>
        <SidebarMenuItem data-organization="">
          <div className="flex h-12 items-center gap-2 p-2">{badge}</div>
        </SidebarMenuItem>
      </SidebarMenu>
    )
  }
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={(props, { open }) => (
              <SidebarMenuButton
                size="lg"
                data-state={open ? 'open' : 'closed'}
                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                {...props}
              >
                {badge}
                <ChevronsUpDown className="ms-auto" />
              </SidebarMenuButton>
            )}
          />
          <DropdownMenuContent
            className="min-w-56 rounded-lg max-sm:**:data-[slot$=item]:min-h-11"
            align="start"
            side={isMobile ? 'bottom' : 'right'}
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                {t('admin.organizations', 'Organizations')}
              </DropdownMenuLabel>
              {/* Radio items, so the current organization is `aria-checked`; `closeOnClick`
                  because a radio item does not close the menu by itself. */}
              <DropdownMenuRadioGroup value={active?.id} onValueChange={onSwitch}>
                {organizations.map((one) => (
                  <DropdownMenuRadioItem key={one.id} value={one.id} closeOnClick className={radioRow}>
                    {named(one)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

/**
 * The user menu: avatar, name and email, a link to each of the viewer's other screens, a locale
 * group, a theme group and sign-out. The locale and theme groups draw only where they can work.
 */
export function NavUserMenu({
  locale,
  locales,
  onLocale,
  onSignOut,
  t,
  themes = defaultThemes,
  user,
}: {
  locale?: string
  locales?: readonly string[]
  onLocale?: (locale: string) => void
  onSignOut: () => void
  t: Translate
  /**
   * Which themes the menu offers: `defaultThemes` unless given, none for `[]`. Drawn only where a
   * `ThemeProvider` is above. Rows keep the order light, dark, system.
   */
  themes?: readonly Theme[]
  user: NavUser
}) {
  const { isMobile } = useSidebar()
  const provided = useTheme()
  const screens = user.screens
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={(props, { open }) => (
              <SidebarMenuButton
                data-state={open ? 'open' : 'closed'}
                size="lg"
                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                {...props}
              >
                <Avatar className="h-8 w-8 rounded-lg grayscale">
                  <AvatarFallback className="rounded-lg">{initialsOf(user.name)}</AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-start text-sm leading-tight">
                  <span className="truncate font-medium">{user.name}</span>
                  <span className="text-muted-foreground truncate text-xs">{user.email}</span>
                </div>
                <ChevronsUpDown className="ms-auto size-4" />
              </SidebarMenuButton>
            )}
          />
          <DropdownMenuContent
            className="min-w-56 rounded-lg w-56 max-sm:**:data-[slot$=item]:min-h-11"
            side={isMobile ? 'bottom' : 'top'}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-start text-sm">
                  <Avatar className="h-8 w-8 rounded-lg">
                    <AvatarFallback className="rounded-lg">{initialsOf(user.name)}</AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-start text-sm leading-tight">
                    <span className="truncate font-medium">{user.name}</span>
                    <span className="text-muted-foreground truncate text-xs">{user.email}</span>
                  </div>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            {screens && screens.length > 0 ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  {screens.map((one) => (
                    <DropdownMenuItem key={one.name} className="max-sm:min-h-11" render={<a href={one.path} />}>
                      <LayoutGrid className="me-2 h-4 w-4" />
                      {t(`screens.${one.name}`, one.name) ?? one.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </>
            ) : null}
            {locales && locales.length > 0 && onLocale ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  {localeEntries(locales, locale ?? '').map((entry) => (
                    <DropdownMenuItem key={entry.locale} className="max-sm:min-h-11" onClick={() => onLocale(entry.locale)}>
                      <Languages className="me-2 h-4 w-4" />
                      {entry.label}
                      {entry.active ? <Check className="ms-auto h-4 w-4" /> : null}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </>
            ) : null}
            {provided && themes.length > 0 ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="text-xs text-muted-foreground">{t('admin.theme', 'Toggle theme')}</DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={provided.theme} onValueChange={(next) => provided.setTheme(next as Theme)}>
                    {(
                      [
                        ['light', Sun, t('admin.themeLight', 'Light')],
                        ['dark', Moon, t('admin.themeDark', 'Dark')],
                        ['system', Monitor, t('admin.themeSystem', 'System')],
                      ] as const
                    )
                      .filter(([value]) => themes.includes(value))
                      .map(([value, Icon, label]) => (
                        <DropdownMenuRadioItem key={value} value={value} closeOnClick className={radioRow}>
                          <Icon />
                          {label}
                        </DropdownMenuRadioItem>
                      ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
              </>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="max-sm:min-h-11" onClick={onSignOut}>
              <LogOut className="me-2 h-4 w-4" />
              {t('admin.signOut', 'Sign out')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
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
// mithaq-admin 98077394ab68bdf56d5bf3e255c233120e7a13c1 5d2a553925f15a7bfd4725ba879af3ec9b616c82903c3a68232164c486dfba55
