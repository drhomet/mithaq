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

/**
 * Where a signed-in person goes: the path asked for where it lies inside a screen they open, else the
 * one screen they open, else `/unauthorized`, which asks which of several or says why there is none.
 * A path in a screen they do not open is not followed, since there they would only be refused.
 */
export const landing = ({ asked, screens }: { asked: string | undefined; screens: readonly string[] }): string => {
  const home = screens.length === 1 ? screens[0]! : '/unauthorized'
  const path = wanted({ asked, home })
  return screens.some((screen) => path.startsWith(screen) && (path.length === screen.length || '/?#'.includes(path[screen.length]!))) ? path : home
}
