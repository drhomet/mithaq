/**
 * Where signing in lands: only a path of this origin, so a link cannot turn the sign-in page
 * into a jump to another site; anything else lands on `home`.
 *
 * The origin is the URL parser's answer rather than a prefix test's, so `https://elsewhere`,
 * `//elsewhere` and `javascript:` are refused however they are spelled. A backslash, a C0 control
 * and DEL are refused before the parse, since the parser rewrites or strips them before reading
 * the host. They are written as escapes so git and grep keep reading this file as text.
 */
const base = 'https://mithaq.invalid'

export const wanted = ({ asked, home }: { asked: string | undefined; home: string }): string => {
  if (asked === undefined || !asked.startsWith('/') || /[\\\x00-\x1f\x7f]/.test(asked)) return home
  try {
    return new URL(asked, base).origin === base ? asked : home
  } catch {
    // `new URL('//', base)` throws rather than resolving.
    return home
  }
}
