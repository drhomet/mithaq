// `server` is a module augmentation `@tanstack/start-client-core` declares; the erased type-only
// import below loads it, so this app still ships `@tanstack/react-router` alone.
import { createFileRoute } from '@tanstack/react-router'
import type {} from '@tanstack/start-client-core'
import { asas } from 'asas'

// `/api/$` because one handler owns all of `/api`. The generated `routeTree.gen.ts` sits under
// `src/` so the root `tsc` sees the `FileRoutesByPath` augmentation that types this path.
export const Route = createFileRoute('/api/$')({
  server: { handlers: { ANY: ({ request }) => asas.handler(request) } },
})
