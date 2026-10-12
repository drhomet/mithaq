import handler, { createServerEntry } from '@tanstack/react-start/server-entry'
import type { ScreenClient } from 'mithaq/admin'
import { checkComponents } from './components/mithaq/components.tsx'
import { components } from './router.tsx'
import { withQuietAbort } from './quiet-abort.ts'

// Every screen this app serves, checked against its components map as it starts, so a field whose kind has no
// control fails the start, naming the kind and the field, and never reaches a page. Read on the server alone,
// since a screen.json names every field of the screen.
for (const client of Object.values(import.meta.glob<ScreenClient>('./routes/(screens)/*/screen.json', { eager: true, import: 'default' }))) {
  checkComponents({ client, components })
}

// A production start connects once before handing on any request, and `connect()` refuses to
// start while a migration is unapplied; a refused start exits 1. NODE_ENV is read off `process`
// so Vite cannot replace it at build time, and a built server started without
// `NODE_ENV=production` never connects, which would push into the deploy's database.
const { env } = process
if (env.NODE_ENV === 'production') {
  await (await import('asas')).asas.connect().catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
}

export default createServerEntry({ fetch: (request: Request) => handler.fetch(withQuietAbort(request)) })
