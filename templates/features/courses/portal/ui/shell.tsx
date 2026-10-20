// The portal's frame, its own look apart from the dashboard's: the organization's name at its head, which is the
// site's name in every locale, the portal's three places as pills across the top from md up and as a tab bar at
// the foot of a phone, and one column between them. Its colors are the shadcn tokens the primitives read, set
// here to the portal's teal and amber for each theme, so a Button or a Card inside it is the portal's without a
// class of its own.
import '@fontsource-variable/bricolage-grotesque'
import { use, useState, type ReactNode } from 'react'
import { BookOpen, ClipboardCheck, House, Wrench, type LucideIcon } from 'lucide-react'
// add-on: settings
import { useQuery } from '@tanstack/react-query'
import type { Row } from 'mithaq/admin'
import { useClient } from 'mithaq/admin/react'
// end add-on: settings
import type { NavEntry, ShellProps } from 'mithaq/admin'
import { ScreenContext, useAccess, useLocale, useNav, useScreen, useUser } from 'mithaq/admin/react'
import { holds } from 'mithaq/admin'
import { currentOf } from 'mithaq-admin/nav-links.tsx'
import { DiscardDialog } from 'mithaq-admin/discard-dialog.tsx'
import { SidebarProvider } from '@/components/ui/sidebar'
import { locales, switchLocale } from '@/copy.ts'
import { frame, UserMenu } from '@asas/mithaq/ui/app-shell.tsx'
import { navLabel } from '@asas/mithaq/ui/screen-nav.tsx'
import { nameIn } from '@asas/mithaq/mithaq/auth/organizations.ts'
// add-on: settings
import { closedTo } from './rules.ts'
// end add-on: settings

export const regions = ['header', 'main'] as const

/**
 * The portal's colors over shadcn's tokens, light and dark. Teal is the brand, amber its accent; each pair is
 * 4.5:1 or more, text on its ground.
 */
const tokens = [
  '[--background:#F5F5F0] [--foreground:#1B1F24] [--card:#FFFFFF] [--card-foreground:#1B1F24]',
  '[--primary:#0F6E6E] [--primary-foreground:#FFFFFF] [--ring:#0F6E6E] [--muted-foreground:#555A60]',
  '[--accent:#EAF3F2] [--accent-foreground:#0F6E6E] [--border:#E4E4DC] [--input:#D9D9D0] [--portal-amber:#E8A33D]',
  'dark:[--background:#0E1414] dark:[--foreground:#ECEFEE] dark:[--card:#172020] dark:[--card-foreground:#ECEFEE]',
  'dark:[--primary:#5FB8B3] dark:[--primary-foreground:#0B2524] dark:[--ring:#5FB8B3] dark:[--muted-foreground:#A4B0AE]',
  'dark:[--accent:#16312F] dark:[--accent-foreground:#9CD9D4] dark:[--border:#26302F] dark:[--input:#34403F] dark:[--portal-amber:#E8A33D]',
].join(' ')

/** The display face of the portal's headings. Its Latin is Bricolage Grotesque; Arabic falls to IBM Plex Sans Arabic. */
export const display = "font-['Bricolage_Grotesque_Variable','IBM_Plex_Sans_Arabic',sans-serif] font-bold tracking-tight"

const icons: Record<string, LucideIcon> = { '/': House, '/courses': BookOpen, '/enrollments': ClipboardCheck }

// add-on: settings
/** The organization's settings as the viewer reads them, or `null` where it may not or none are written yet. */
const useSettings = () => {
  const client = useClient()
  return useQuery({
    queryKey: ['portal-settings'],
    queryFn: () => (client({ kayan: 'settings', operation: 'findOne', input: {} }) as Promise<Row | null>).catch(() => null),
    staleTime: 60_000,
  }).data
}
// end add-on: settings

/** One place of the portal: its link, its label, and whether the viewer is on it. */
const usePlaces = () => {
  const { locale, t } = useLocale()
  const screen = useScreen()
  const access = useAccess()
  const state = use(ScreenContext)
  // A seat of anyone's is no longer the viewer's own, so the list is "My enrollments" only to a student.
  const label = (entry: NavEntry) =>
    entry.kayan === 'enrollments' && !holds(access, 'enrollments.others') ? t('portal.myEnrollments', 'My enrollments')! : navLabel({ entry, screen, locale, t })!
  return [
    { path: '/', href: screen.path, label: t('portal.home', 'Home')!, current: state?.path === screen.path },
    ...useNav().filter((entry) => !entry.hidden).map((entry) => ({ path: entry.path, href: `${screen.path}${entry.path}`, label: label(entry), current: currentOf(entry, state?.kayan?.name) === 'page' })),
  ]
}

/** The other language, offered as its own name, so a reader who cannot read this one still finds theirs. */
function LocaleButton() {
  const { locale } = useLocale()
  const other = locales.find((one) => one !== locale) ?? locale
  // Asked first, in the app's discard dialog, where a form holds a change nobody saved.
  const [asked, setAsked] = useState(false)
  const { t } = useLocale()
  return (
    <>
      <button
        type="button"
        lang={other}
        aria-label={other === 'ar' ? 'العربية' : 'English'}
        onClick={() => (window.onbeforeunload ? setAsked(true) : switchLocale({ to: other }))}
        className="border-input bg-card text-foreground focus-visible:ring-ring inline-flex h-11 min-w-11 items-center justify-center rounded-full border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none"
      >
        {other === 'ar' ? 'ع' : 'EN'}
      </button>
      <DiscardDialog open={asked} onOpenChange={setAsked} onDiscard={() => switchLocale({ to: other })} t={t} />
    </>
  )
}

/** What a student meets while the portal is closed for maintenance: why, and where to write meanwhile. */
function Closed({ contact }: { contact?: string }) {
  const { t } = useLocale()
  return (
    <section data-portal-closed="" className="bg-card mx-auto grid max-w-md justify-items-center gap-3 rounded-3xl px-6 py-12 text-center">
      <Wrench aria-hidden className="text-primary size-10" />
      <h1 className={`${display} text-2xl`}>{t('portal.closed', 'Closed for maintenance')}</h1>
      <p className="text-muted-foreground">{t('portal.closedBody', 'The school is working on the portal. Please come back soon.')}</p>
      {contact ? <Contact email={contact} /> : null}
    </section>
  )
}

function Contact({ email }: { email: string }) {
  const { t } = useLocale()
  return (
    <p className="text-muted-foreground text-sm">
      {t('portal.contact', 'Questions? Write to')}{' '}
      <a href={`mailto:${email}`} dir="ltr" className="text-primary font-medium underline-offset-4 hover:underline">{email}</a>
    </p>
  )
}

export function PortalShell({ regions }: ShellProps<readonly ['header', 'main'], ReactNode>) {
  const { locale, t } = useLocale()
  const user = useUser()
  const places = usePlaces()
  // add-on: settings
  const access = useAccess()
  const settings = useSettings()
  // The page answers what the viewer reads either way; this only draws the closed page in its place.
  const closed = closedTo({ maintenance: settings?.maintenance, access })
  const contact = typeof settings?.contactEmail === 'string' && settings.contactEmail ? settings.contactEmail : undefined
  // end add-on: settings
  // without add-on: settings
  // const closed = false
  // const contact: string | undefined = undefined
  // end without add-on: settings
  const active = user.organizations?.find((one) => one.id === user.activeOrganizationId)
  const site = active ? nameIn(active, locale) : t('portal.title', 'Portal')!
  const nav = t('portal.navigation', 'Portal')
  return (
    <SidebarProvider data-shell="top" data-portal="" style={frame} className={`bg-background text-foreground min-h-svh flex-col ${tokens}`}>
      <header className="bg-card border-b">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <a href={places[0]!.href} className="flex min-w-0 items-center gap-2.5 font-semibold">
            <span aria-hidden className="bg-primary text-primary-foreground grid size-9 shrink-0 place-items-center rounded-[10px]">{[...site][0]}</span>
            <span className="truncate">{site}</span>
          </a>
          <nav aria-label={nav} className="hidden gap-1 md:flex">
            {places.map((place) => (
              <a
                key={place.path}
                href={place.href}
                aria-current={place.current ? 'page' : undefined}
                className="text-foreground/80 hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground inline-flex h-11 items-center rounded-full px-4 text-[15px] aria-[current=page]:font-semibold"
              >
                {place.label}
              </a>
            ))}
          </nav>
          <div className="flex shrink-0 items-center gap-2">
            <LocaleButton />
            {/* The avatar alone: the menu signs out and switches locale too. */}
            <div className="w-12 [&_[data-slot=avatar]]:grayscale-0 [&_[data-slot=avatar-fallback]]:bg-(--portal-amber) [&_[data-slot=avatar-fallback]]:text-[#1B1F24]">
              <UserMenu />
            </div>
          </div>
        </div>
      </header>
      <main data-region="main" className="mx-auto grid w-full max-w-6xl grid-cols-[minmax(0,1fr)] content-start gap-6 px-4 pt-6 pb-28 sm:px-6 md:pb-12">
        {closed ? <Closed contact={contact} /> : <><div data-region="header">{regions.header}</div>{regions.main}</>}
      </main>
      {contact && !closed ? (
        <footer className="mx-auto w-full max-w-6xl px-4 pb-28 sm:px-6 md:pb-8">
          <Contact email={contact} />
        </footer>
      ) : null}
      <nav aria-label={nav} className="bg-card fixed inset-x-0 bottom-0 z-10 grid grid-cols-3 border-t px-2 pt-1.5 pb-[max(env(safe-area-inset-bottom),0.75rem)] md:hidden">
        {places.map((place) => {
          const Icon = icons[place.path] ?? BookOpen
          return (
            <a
              key={place.path}
              href={place.href}
              aria-current={place.current ? 'page' : undefined}
              className="text-muted-foreground aria-[current=page]:text-primary flex min-h-13 flex-col items-center justify-center gap-1 text-xs aria-[current=page]:font-semibold"
            >
              <Icon aria-hidden className="size-[22px]" />
              {place.label}
            </a>
          )
        })}
      </nav>
    </SidebarProvider>
  )
}
