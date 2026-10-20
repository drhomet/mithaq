import { use, type ReactElement } from 'react'
import { ScreenContext, useLocale, useScreen } from 'mithaq/admin/react'
import { titleOf } from 'mithaq-admin/copy.ts'

/**
 * Whether a nav entry is the page the viewer is on: its kayan is the page's own, on every page of that
 * kayan. Known on the server, so the first paint marks it.
 */
export const currentOf = (entry: { kayan?: string }, kayan: string | undefined): 'page' | undefined =>
  entry.kayan !== undefined && entry.kayan === kayan ? 'page' : undefined

/** The screen's nav as the host provides it: one link per entry under the screen's path. */
export function NavLinks(): ReactElement {
  const screen = useScreen()
  const copy = useLocale()
  const current = use(ScreenContext)?.kayan?.name
  return (
    <ul className="flex flex-col gap-1">
      {screen.nav.filter((entry) => !entry.hidden).map((entry) => (
        <li key={`${entry.page}${entry.path}`}>
          <a href={`${screen.path}${entry.path}`} aria-current={currentOf(entry, current)} className="text-sm">
            {entry.label?.[copy.locale] ?? titleOf({ kayan: { name: entry.kayan ?? entry.page }, copy, many: !screen.kayan[entry.kayan ?? '']?.single })}
          </a>
        </li>
      ))}
    </ul>
  )
}
