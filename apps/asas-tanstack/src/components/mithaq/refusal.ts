export const refusalKeyOf = (error: unknown): string | undefined => {
  // A refusal carries its key as `data: { key, params }`, which a client resolves against its own copy; anything else carries none.
  // Inside the body, because `shadcn add` drops a file's leading comment block.
  const key = (error as { data?: { key?: unknown } } | null | undefined)?.data?.key
  return typeof key === 'string' ? key : undefined
}

/**
 * Which locales of each localized field a refusal names, off the issue paths: `title.ar` names the Arabic box of `title`. A path of one segment names no locale.
 */
export const localesOf = (error: unknown): Readonly<Record<string, readonly string[]>> => {
  const issues = (error as { data?: { params?: { issues?: unknown } } } | null | undefined)?.data?.params?.issues
  const byField: Record<string, string[]> = Object.create(null)
  if (!Array.isArray(issues)) return byField
  for (const issue of issues as readonly { path?: unknown }[]) {
    const [name, locale] = typeof issue?.path === 'string' ? issue.path.split('.') : []
    if (name && locale) (byField[name] ??= []).push(locale)
  }
  return byField
}

/**
 * Whether a read was refused by the viewer's access (a 403) rather than failed, so a cell says the viewer cannot see a row for the first and never for a 500 or a network failure.
 */
export const isForbidden = (thrown: unknown): boolean =>
  (thrown as { status?: unknown } | null | undefined)?.status === 403 || refusalKeyOf(thrown)?.startsWith('error.forbidden') === true
// mithaq-admin 2d291bd0eb55a5e558611f2aebacfde532e4a7b8 3394535a4fe326ec5cf2b5ec409d77a7bbab4cf085c26bad6f2400c3674e79dd
