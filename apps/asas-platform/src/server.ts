import handler, { createServerEntry } from '@tanstack/react-start/server-entry'
import { withQuietAbort } from '../../asas-tanstack/src/quiet-abort.ts'

// A refused start (a migration not applied) exits 1 rather than leave a server up that cannot serve.
const { env } = process
if (env.NODE_ENV === 'production') {
  await (await import('asas')).asas.connect().catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
}

// Every request runs as the platform; nothing a request carries decides it, and the tenant app never does.
// `asas` is imported per request so it is the same module every route reads.
export default createServerEntry({
  fetch: async (request: Request) => {
    const { asPlatform } = await import('asas')
    return asPlatform(() => handler.fetch(withQuietAbort(request)))
  },
})
