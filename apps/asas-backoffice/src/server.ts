import handler, { createServerEntry } from '@tanstack/react-start/server-entry'
import type { ScreenClient } from 'mithaq/admin'
import { checkComponents } from 'mithaq-admin/components.tsx'
import { components } from './components.ts'
import { withQuietAbort } from '../../asas-tanstack/src/quiet-abort.ts'

// Every screen this app serves, checked against its components map as it starts, so a field whose kind has no
// control fails the start, naming the kind and the field, and never reaches a page. Read on the server alone,
// since a screen.json names every field of the screen.
for (const client of Object.values(import.meta.glob<ScreenClient>('./routes/(screens)/*/screen.json', { eager: true, import: 'default' }))) {
  checkComponents({ client, components })
}

// A refused start (a migration not applied) exits 1 rather than leave a server up that cannot serve.
const { env } = process
if (env.NODE_ENV === 'production') {
  await (await import('asas')).asas.connect({
    // add-on: uploads
    work: ['maintenance'],
    // end add-on: uploads
  }).catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
}

// Every request runs as the backoffice; nothing a request carries decides it, and the tenant app never does.
// `asas` is imported per request so it is the same module every route reads.
export default createServerEntry({
  fetch: async (request: Request) => {
    const { asBackoffice } = await import('asas')
    return asBackoffice(() => handler.fetch(withQuietAbort(request)))
  },
})
