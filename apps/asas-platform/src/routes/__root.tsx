import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'
import { DirectionProvider } from '@/components/ui/direction'
export { locales } from '../copy.ts'
import { dirOf, documentHead, localeOf, translator } from '../copy.ts'
import { ThemeProvider } from 'mithaq-admin/theme.tsx'
import { themeStorageKey } from '../theme.ts'
import appCss from '../styles.css?url'

// Puts the chosen theme on the document before first paint, which the provider's effect cannot do.
// Also reloads a page restored from the back-forward cache, so Back after signing out asks the server again.
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

// A request context nothing registered is `never` in the router's types, so the shape is named and read
// through a cast; `localeOf` turns it back into a declared locale.
type FromRequest = { serverContext?: { locale?: unknown } }

export const Route = createRootRoute({
  // On the client the locale is read back off the `lang` the server wrote on `<html>`, so the hydrated tree
  // matches the one sent. `localeOf` on both refuses a hand-edited `lang` like a hand-written cookie.
  beforeLoad: (ctx) => {
    const locale =
      typeof document === 'undefined'
        ? localeOf((ctx as unknown as FromRequest).serverContext?.locale as string | undefined)
        : localeOf(document.documentElement.lang)
    return { locale, dir: dirOf(locale), app: 'platform.brand' }
  },
  // The favicon stops the browser asking for a `/favicon.ico` nobody serves.
  head: ({ match }) => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      ...documentHead(match.context, match._notFound ? (t) => t('admin.notFoundTitle', 'Page not found') : undefined).meta,
    ],
    links: [{ rel: 'stylesheet', href: appCss }, { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
  }),
  // Without it the router draws a development-only placeholder and warns.
  notFoundComponent: NotFound,
  component: RootDocument,
})

/** The locale and direction of this request and the `t` resolved for it, read from the root route's context. */
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
        {/* The string is this module's own and carries no request value, so writing it raw is safe. */}
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
