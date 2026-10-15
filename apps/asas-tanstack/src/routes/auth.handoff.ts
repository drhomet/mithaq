// Trades the backoffice's one-time impersonation token for the session through the plugin's own
// verify, then lands on the first screen the impersonated person may enter. The access report is
// read with only the session the verify set, so the landing grants nothing. A spent, expired or
// unknown token sets nothing and lands on sign-in.
import { createFileRoute } from '@tanstack/react-router'
import type {} from '@tanstack/start-client-core'

const firstScreen = (targets: unknown, listed: readonly string[], backoffice: string) => {
  const screens = targets as Record<string, { capability?: string; client?: { path: string } } | undefined>
  const name = listed.find((one) => one !== backoffice && screens[one]?.capability === 'screen')
  return name ? screens[name]!.client!.path : '/unauthorized'
}

export const Route = createFileRoute('/auth/handoff')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { asas, tenantURL, BACKOFFICE_SCREEN } = await import('asas')
        // The deployment's own origin, never the request's, whose host a caller writes.
        const own = new URL(tenantURL).origin
        const verified = await asas.handler(
          new Request(new URL('/api/auth/user/one-time-token/verify', own), {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: own },
            body: JSON.stringify({ token: new URL(request.url).searchParams.get('token') ?? '' }),
          }),
        )
        const cookies = verified.headers.getSetCookie()
        const session = cookies.map((cookie) => cookie.split(';')[0]).join('; ')
        const report = verified.ok
          ? ((await (await asas.handler(new Request(new URL('/api/access', own), { headers: { cookie: session } }))).json().catch(() => ({}))) as { screens?: string[] })
          : undefined
        const headers = new Headers({ location: report ? firstScreen(asas.targets, report.screens ?? [], BACKOFFICE_SCREEN) : '/auth/sign-in' })
        for (const cookie of cookies) headers.append('set-cookie', cookie)
        return new Response(null, { status: 302, headers })
      },
    },
  },
})
