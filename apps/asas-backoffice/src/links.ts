/**
 * The path a click on a plain `<a href>` is routed to inside the screen, or
 * `undefined` for a click the browser keeps: a modified or handled click, another
 * target, a download, another origin, or a path outside the screen's `base`.
 */
export const routedHref = ({
  event,
  origin,
  base,
}: {
  event: Pick<MouseEvent, 'button' | 'metaKey' | 'altKey' | 'ctrlKey' | 'shiftKey' | 'defaultPrevented' | 'target'>
  origin: string
  base: string
}): string | undefined => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return undefined
  const anchor = (event.target as Element | null)?.closest?.('a[href]')
  const target = anchor?.getAttribute('target')
  if (!anchor || (target && target !== '_self') || anchor.hasAttribute('download')) return undefined
  // The browser's own resolution against the current page: against the origin
  // alone, `href="edit"` on `/dashboard/courses/` would read as `/edit`.
  const url = new URL((anchor as HTMLAnchorElement).href)
  if (url.origin !== origin || (url.pathname !== base && !url.pathname.startsWith(`${base}/`))) return undefined
  return `${url.pathname}${url.search}${url.hash}`
}

/**
 * Where a list asked for a page past its last is sent instead: the same URL at
 * the last page, or with no page where the last is the first. `undefined` for a
 * page in range.
 */
export const clampedHref = ({ href, page, totalPages }: { href: string; page: number; totalPages: number }): string | undefined => {
  if (page <= Math.max(1, totalPages)) return undefined
  const url = new URL(href, 'http://local')
  if (totalPages > 1) url.searchParams.set('page', String(totalPages))
  else url.searchParams.delete('page')
  return `${url.pathname}${url.search}${url.hash}`
}
// mithaq-admin 2d3ab739c92c6c2b397041b76bf4b23b2902b7a2 4754cbac64eeac528e7e037173ad56ffa8d07df3e526e1191bbe3be400db97a5
