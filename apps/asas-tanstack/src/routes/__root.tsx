import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'
import { DirectionProvider } from '@/components/ui/direction'
export { locales } from '../copy.ts'
import { dirOf, documentHead, localeOf, translator } from '../copy.ts'
import { ThemeProvider } from 'mithaq-admin/theme.tsx'
import { themeStorageKey } from '../theme.ts'
import appCss from '../styles.css?url'

/**
 * Puts the chosen theme on the document before the first paint, which React cannot do: it
 * reads `localStorage` only after mount. Also reloads a page restored from the back-forward
 * cache, so Back after signing out asks the server again instead of showing the signed-in page.
 */
const theme = `
              (function() {
                var storageKey = ${JSON.stringify(themeStorageKey)};
                var defaultTheme = "system";
                try {
                  var theme = localStorage.getItem(storageKey) || defaultTheme;
                  var systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
                  var root = document.documentElement;
                  root.classList.remove("light", "dark");
                  root.classList.add(theme === "system" ? systemTheme : theme);
                } catch (e) {}
                window.addEventListener("pageshow", function (event) {
                  if (event.persisted) location.reload();
                });
              })()
            `

/**
 * An unregistered request context is `never` in the router's types, so the shape is named
 * here and read through a cast; `localeOf` turns it back into a declared locale.
 */
type FromRequest = { serverContext?: { locale?: unknown } }

export const Route = createRootRoute({
  // On the client the locale is the `lang` the server wrote on `<html>`, so the hydrated tree matches
  // the one sent. `localeOf` on both sides refuses a hand-edited `lang` or cookie.
  beforeLoad: (ctx) => {
    const locale =
      typeof document === 'undefined'
        ? localeOf((ctx as unknown as FromRequest).serverContext?.locale as string | undefined)
        : localeOf(document.documentElement.lang)
    return { locale, dir: dirOf(locale), app: 'marketing.brand' }
  },
  head: ({ match }) => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      // `_notFound` is the router's mark on the root match it draws the not-found for.
      ...documentHead(match.context, match._notFound ? (t) => t('admin.notFoundTitle', 'Page not found') : undefined).meta,
    ],
    links: [{ rel: 'stylesheet', href: appCss }, { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
  }),
  // Without it the router draws a development-only placeholder and warns.
  notFoundComponent: NotFound,
  component: RootDocument,
})

export const useCopy = () => {
  const { dir, locale } = Route.useRouteContext()
  return { dir, locale, t: translator(locale) }
}

function NotFound() {
  const { t } = useCopy()
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-bold tracking-tight">{t('admin.notFoundTitle', 'Page not found')}</h1>
      <p className="text-muted-foreground text-sm">{t('admin.notFound', 'That page does not exist.')}</p>
      {/* An anchor, because `/` is no route here. */}
      <a className="text-foreground text-sm underline underline-offset-4" href="/">
        {t('admin.goHome', 'Go to the home page')}
      </a>
    </main>
  )
}

function RootDocument() {
  const { dir, locale } = useCopy()
  return (
    <html lang={locale} dir={dir} suppressHydrationWarning>
      <head>
        <HeadContent />
        {/* Safe to write raw: the string is this module's own and carries no value from a request. */}
        <script dangerouslySetInnerHTML={{ __html: theme }} />
      </head>
      <body>
        <DirectionProvider direction={dir}>
          <ThemeProvider defaultTheme="system" storageKey={themeStorageKey}>
            <Outlet />
          </ThemeProvider>
        </DirectionProvider>
        <Scripts />
      </body>
    </html>
  )
}
