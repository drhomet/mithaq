import { Check, ChevronsUpDown, Languages, LayoutGrid, LogOut, Monitor, Moon, Sun } from 'lucide-react'
import type { Translate } from 'mithaq/admin'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
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
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/components/ui/sidebar'
import { localeEntries } from './locale-menu.ts'
import { defaultThemes, useTheme, type Theme } from './theme.tsx'

/** A radio row: a 44 pixel target on a phone, and the tick on the inline end in right-to-left pages, where the primitive draws it at the right. */
const radioRow = 'max-sm:min-h-11 rtl:pr-3 rtl:pl-8 rtl:[&>[data-slot=dropdown-menu-radio-item-indicator]]:right-auto rtl:[&>[data-slot=dropdown-menu-radio-item-indicator]]:left-2'

/** What the shell is told about the viewer, which is the two strings the user menu draws. */
export type NavUser = {
  name: string
  email: string
  /** The other screens the host links for this viewer, each a whole address; the user menu draws a link to each. */
  screens?: readonly { name: string; path: string }[]
}

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('') || '?'

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
// mithaq-admin 18e80532b8fb462dbba313622bcd6ee8762c2c92 8006f290530217a3408ae99acdf0cf9808c34f3c4cc46813b4d87d36f9a924ca
