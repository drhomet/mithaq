import { createFileRoute } from '@tanstack/react-router'
// Loads the types of the `server` route option; erased at build.
import type {} from '@tanstack/start-client-core'
import { asas, backofficeURL } from 'asas'

// The backoffice reads every organization: a read of a kayan asks `tenant: 'all'`, which the runner
// grants backoffice staff in this app alone and refuses anyone else. A global is one organization's row
// and asks for none.
const reads = new Set(asas.operations.filter((one) => one.effect === 'read' && !one.single).map((one) => `/api/${one.kayan}/${one.name}`))

// The body is handed on unread, so the plug that answers bounds it before any session is looked at.
const acrossTenants = (request: Request) => {
  const url = new URL(request.url)
  if (!reads.has(url.pathname)) return request
  url.searchParams.set('tenant', 'all')
  return new Request(url, { method: request.method, headers: request.headers, body: request.body, signal: request.signal, duplex: 'half' } as RequestInit)
}

// A write whose `Origin` is not BACKOFFICE_URL's is refused: the data plug checks no origin and leans on
// the session cookie's `SameSite=Lax`, which the customer app's sibling subdomain passes, so this check
// is the barrier between the two. Never the URL the request arrived on: behind a TLS proxy it is
// http://, and its host is whatever the Host header said.
const origin = new URL(backofficeURL).origin

export const Route = createFileRoute('/api/$')({
  server: {
    handlers: {
      ANY: async ({ request }) =>
        request.method === 'GET' || request.method === 'HEAD' || request.headers.get('origin') === origin
          ? asas.handler(acrossTenants(request))
          : new Response('Forbidden', { status: 403 }),
    },
  },
})
