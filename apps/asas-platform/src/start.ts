import { createCsrfMiddleware, createMiddleware, createStart } from '@tanstack/react-start'
import { dirOf, localeCookie, localeOf } from './copy.ts'

// Not decoded: the only caller accepts two ASCII letters.
const cookieOf = (header: string | null, name: string): string | undefined =>
  header
    ?.split(';')
    .map((one) => one.trim().split('='))
    .find(([key]) => key === name)
    ?.slice(1)
    .join('=')

// The locale comes from the `locale` cookie alone, and `en` when there is none.
const locale = createMiddleware({ type: 'request' }).server(({ request, next }) => {
  const asked = localeOf(cookieOf(request.headers.get('cookie'), localeCookie))
  return next({ context: { locale: asked, dir: dirOf(asked) } })
})

// Checks server function calls only; page renders and the plain HTTP arm under `/api` are untouched.
const csrf = createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === 'serverFn' })

// The location is a path of this origin, so nothing the request's host header says reaches it.
const home = createMiddleware({ type: 'request' }).server(({ request, next }) =>
  new URL(request.url).pathname === '/' ? new Response(null, { status: 307, headers: { location: '/platform' } }) : next(),
)

// Only this origin may frame the pages, so no other site can lay this app under its own page and steer a click.
// First, so it covers every other middleware's answer; the answer is rebuilt because a redirect's headers are immutable.
const framing = createMiddleware({ type: 'request' }).server(async ({ next }) => {
  const result = await next()
  const answer = result.response
  const html = answer.headers.get('content-type')?.startsWith('text/html') === true
  if (answer.headers.has('content-security-policy') && !html) return result
  const headers = new Headers(answer.headers)
  if (!headers.has('content-security-policy')) headers.set('content-security-policy', "frame-ancestors 'self'")
  // Every HTML answer is drawn for one session and locale, so a signed-out page must not come back
  // from the cache on Back; the root document's script reloads a page the back-forward cache restores.
  if (html) headers.set('cache-control', 'no-store')
  return { ...result, response: new Response(answer.body, { status: answer.status, statusText: answer.statusText, headers }) }
})

export const startInstance = createStart(() => ({ requestMiddleware: [framing, home, csrf, locale] }))
