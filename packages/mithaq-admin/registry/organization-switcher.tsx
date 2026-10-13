import { ChevronsUpDown, GalleryVerticalEnd } from 'lucide-react'
import type { Translate } from 'mithaq/admin'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/components/ui/sidebar'

/** A radio row: a 44 pixel target on a phone, and the tick on the inline end in right-to-left pages, where the primitive draws it at the right. */
const radioRow = 'max-sm:min-h-11 rtl:pr-3 rtl:pl-8 rtl:[&>[data-slot=dropdown-menu-radio-item-indicator]]:right-auto rtl:[&>[data-slot=dropdown-menu-radio-item-indicator]]:left-2'

/**
 * One organization the switcher lists. Two may share a name, so each carries a slug, which the
 * switcher shows beside a name that repeats.
 */
export type NavOrganization = { id: string; name: string; slug?: string }

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
