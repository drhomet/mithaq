/**
 * A language's own name for itself (`ar` reads `العربية`), whatever the viewer reads in. It is the
 * same in every locale, so it carries no copy key. `of` throws a `RangeError` on a malformed tag,
 * so the tag itself is the fallback.
 */
export const endonym = (locale: string): string => {
  try {
    return new Intl.DisplayNames([locale], { type: 'language' }).of(locale) ?? locale
  } catch {
    return locale
  }
}

/** One row of the user menu's locale group: the locale, what it calls itself, and whether it is the one being read in. */
export const localeEntries = (
  locales: readonly string[],
  current: string,
): readonly { locale: string; label: string; active: boolean }[] =>
  locales.map((one) => ({ locale: one, label: endonym(one), active: one === current }))
