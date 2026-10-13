import { Folder, HelpCircle, MoreHorizontal, Search, Share2, ShieldCheck, Trash2, type LucideIcon } from 'lucide-react'
import type { Translate } from 'mithaq/admin'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'

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
// mithaq-admin 18e80532b8fb462dbba313622bcd6ee8762c2c92 1cb9bb44eb45be9f11887c93afaa3b3b99c97845297efb76c298fceff9312934
