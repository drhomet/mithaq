// The nav a page drawn whole puts in its shell's nav region, since such a page
// has no tree for a `{ nav: {} }` node to sit in: one link per entry of the
// screen's nav, which the host has already cut to the viewer, read through the hooks.
import { use } from 'react'
import type { NavEntry, ScreenClient, Translate } from 'mithaq/admin'
import { ScreenContext, useLocale, useScreen } from 'mithaq/admin/react'
import { currentOf } from 'mithaq-admin/nav-links.tsx'

/** What an entry is called: its own label, else its kayan's name in the singular for a global and the plural otherwise. */
export const navLabel = ({ entry, screen, locale, t }: { entry: NavEntry; screen: ScreenClient; locale: string; t: Translate }) =>
  entry.label?.[locale] ?? t(`${entry.kayan}.${screen.kayan[entry.kayan ?? '']?.single ? 'singular' : 'plural'}`, entry.kayan)

export function ScreenNav() {
  const { locale, t } = useLocale()
  const screen = useScreen()
  const kayan = use(ScreenContext)?.kayan?.name
  return (
    <ul className="flex flex-col gap-1">
      {screen.nav.filter((entry) => !entry.hidden).map((entry) => (
        <li key={entry.page + entry.path}>
          <a href={`${screen.path}${entry.path}`} aria-current={currentOf(entry, kayan)} className="text-sm">
            {navLabel({ entry, screen, locale, t })}
          </a>
        </li>
      ))}
    </ul>
  )
}
