/**
 * The key a refusal carries, as `data: { key, params }`, which a client resolves against its own copy. Anything that is not a refusal carries no key.
 */
export const refusalKeyOf = (error: unknown): string | undefined => {
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
// mithaq-admin 98077394ab68bdf56d5bf3e255c233120e7a13c1 85a0050715a186136fa94d4824b1ce6823c390df8506df70bc27a5911ca9d385
