// The second frame both screens may put at the root of a page: the nav as a
// bar across the top, the header under it, and one column below. The header is the app
// shell's own bar with the user menu at its end in place of the sidebar
// trigger, so both frames sign out and switch locale from the same menu. The
// provider is there for the menu, whose primitives read the sidebar's context;
// no sidebar is drawn.
import { use, type ReactNode } from 'react'
import type { ShellProps } from 'mithaq/admin'
import { ScreenContext, useLocale, useScreen } from 'mithaq/admin/react'
import { SidebarProvider } from '@/components/ui/sidebar'
import { BackofficeLink, UserMenu, frame, headerBar, headerRow } from './app-shell.tsx'

export const regions = ['header', 'nav', 'main'] as const

/** The dashboard's top shell, whose header links the backoffice app for staff the way the app shell's does. */
export function TopShell(props: ShellProps<readonly ['header', 'nav', 'main'], ReactNode>) {
  return <Top {...props} backoffice />
}

/**
 * The portal's, the same shell with no backoffice link: the portal is where a
 * tenant's people work, and staff reach the backoffice from the dashboard
 * alone. Which of the two a page draws is the shell its screen names under
 * `top`, never the URL.
 */
export function PortalTopShell(props: ShellProps<readonly ['header', 'nav', 'main'], ReactNode>) {
  return <Top {...props} backoffice={false} />
}

function Top({ regions, backoffice }: ShellProps<readonly ['header', 'nav', 'main'], ReactNode> & { backoffice: boolean }) {
  const { t } = useLocale()
  const screen = useScreen()
  // Home is current on the screen's own home alone, whose path is the
  // screen's, and each entry on its kayan's pages; the current one is drawn in
  // the foreground and the rest muted. On a phone each link is a 44 pixel row,
  // a touch target.
  const home = use(ScreenContext)?.path === screen.path
  return (
    <SidebarProvider data-shell="top" style={frame} className="flex-col">
      <nav data-region="nav" aria-label={t('admin.mainNavigation', 'Main navigation')} className="mx-auto flex w-full max-w-4xl flex-wrap items-center gap-x-4 gap-y-1 px-6 pt-4 text-sm [&_a]:text-muted-foreground [&_a:hover]:text-foreground [&_a[aria-current=page]]:font-semibold [&_a[aria-current=page]]:text-foreground [&_ul]:flex [&_ul]:flex-row [&_ul]:flex-wrap [&_ul]:gap-x-4 [&_ul]:gap-y-1 max-sm:[&_a]:inline-flex max-sm:[&_a]:min-h-11 max-sm:[&_a]:min-w-11 max-sm:[&_a]:items-center max-sm:[&_a]:justify-center">
        <a href={screen.path} aria-current={home ? 'page' : undefined}>{t('portal.home', 'Home')}</a>
        {regions.nav}
      </nav>
      <header data-region="header" className={`${headerBar} mx-auto w-full max-w-4xl`}>
        <div className={headerRow}>
          {regions.header}
          <div className="ms-auto flex items-center gap-2">
            {backoffice ? <BackofficeLink /> : null}
            {/* The avatar alone on a phone, the whole card from sm up, so the
                title keeps the room it needs. */}
            <div className="w-12 sm:w-56">
              <UserMenu />
            </div>
          </div>
        </div>
      </header>
      <main data-region="main" className="mx-auto grid w-full max-w-4xl grid-cols-[minmax(0,1fr)] gap-4 p-6">{regions.main}</main>
    </SidebarProvider>
  )
}
