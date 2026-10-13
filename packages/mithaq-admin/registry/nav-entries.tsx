import { BookOpen, Building2, CalendarDays, ClipboardList, Mail, PlusCircle, Settings2, ShieldCheck, Table2, Users, type LucideIcon } from 'lucide-react'
import type { ClientKayan } from 'mithaq/admin'
import { Button } from '@/components/ui/button'
import { SidebarGroup, SidebarGroupContent, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
import { titleOf, type Translate } from 'mithaq-admin/copy.ts'

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
