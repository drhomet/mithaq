import { createFileRoute } from '@tanstack/react-router'
// Loads the types of the `server` route option; erased at build.
import type {} from '@tanstack/start-client-core'
import { asas } from 'asas'

// The backoffice reads every organization: a read of a kayan asks `tenant: 'all'`, which the runner
// grants backoffice staff in this app alone and refuses anyone else. A global is one organization's row
// and asks for none.
const reads = new Set(asas.operations.filter((one) => one.effect === 'read' && !one.single).map((one) => `/api/${one.kayan}/${one.name}`))

const acrossTenants = async (request: Request) => {
  const url = new URL(request.url)
  if (!reads.has(url.pathname)) return request
  url.searchParams.set('tenant', 'all')
  const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text()
  return new Request(url, { method: request.method, headers: request.headers, body })
}

// A write whose `Origin` is not this app's own is refused: the data plug checks no origin and leans on
// the session cookie's `SameSite=Lax`, which a sibling origin of the same site passes.
export const Route = createFileRoute('/api/$')({
  server: {
    handlers: {
      ANY: async ({ request }) =>
        request.method === 'GET' || request.method === 'HEAD' || request.headers.get('origin') === new URL(request.url).origin
          ? asas.handler(await acrossTenants(request))
          : new Response('Forbidden', { status: 403 }),
    },
  },
})
