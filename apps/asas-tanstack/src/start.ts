import { createCsrfMiddleware, createMiddleware, createStart } from '@tanstack/react-start'
import { dirOf, localeCookie, localeOf } from './copy.ts'

// The locale is resolved once per request, before any route runs, because the document's `lang`
// and `dir` are written before a loader exists. Nothing here imports
// `@tanstack/react-start/server`: both builds reach this entry, so it would put server code in the client.

/** No `decodeURIComponent`: the only caller refuses every value but two ASCII names. */
const cookieOf = (header: string | null, name: string): string | undefined =>
  header
    ?.split(';')
    .map((one) => one.trim().split('='))
    .find(([key]) => key === name)
    ?.slice(1)
    .join('=')

/**
 * The request's locale and direction, off the `locale` cookie alone: `Accept-Language` is not a
 * choice the viewer made.
 */
const locale = createMiddleware({ type: 'request' }).server(({ request, next }) => {
  const asked = localeOf(cookieOf(request.headers.get('cookie'), localeCookie))
  return next({ context: { locale: asked, dir: dirOf(asked) } })
})

/** Refuses a server function reached from outside the page; page renders and `/api` are untouched. */
const csrf = createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === 'serverFn' })

/**
 * `/admin` answers a 308 to the same path under `/dashboard`, so a saved link still lands with its
 * method and body. The location is a path, never a URL, so the request's host header never reaches it.
 */
const moved = createMiddleware({ type: 'request' }).server(({ request, next }) => {
  const url = new URL(request.url)
  if (!/^\/admin(\/|$)/.test(url.pathname)) return next()
  return new Response(null, { status: 308, headers: { location: `/dashboard${url.pathname.slice('/admin'.length)}${url.search}` } })
})

/**
 * Only this origin may frame this app's pages, so no other site can lay it under its own page and
 * steer a click. First, so it covers every other middleware's answer; rebuilt, since a redirect's
 * headers are immutable.
 */
const framing = createMiddleware({ type: 'request' }).server(async ({ next }) => {
  const result = await next()
  const answer = result.response
  const html = answer.headers.get('content-type')?.startsWith('text/html') === true
  if (answer.headers.has('content-security-policy') && !html) return result
  const headers = new Headers(answer.headers)
  if (!headers.has('content-security-policy')) headers.set('content-security-policy', "frame-ancestors 'self'")
  // No HTML answer is cached: each is drawn for one request's session and locale, so a page
  // someone signed out of must not come back from the cache on Back.
  if (html) headers.set('cache-control', 'no-store')
  return { ...result, response: new Response(answer.body, { status: answer.status, statusText: answer.statusText, headers }) }
})

export const startInstance = createStart(() => ({ requestMiddleware: [framing, moved, csrf, locale] }))
