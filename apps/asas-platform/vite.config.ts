import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { mithaqAdmin } from 'mithaq/vite'
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  // An alias rather than `resolve.tsconfigPaths`: the shells in `templates/mithaq/src` fall under a tsconfig
  // with no `@/` and still import it. `^@/` leaves `@tanstack/*` alone.
  resolve: { alias: [{ find: /^@\//, replacement: fileURLToPath(new URL('./src/', import.meta.url)) }] },
  plugins: [
    tailwindcss(),
    // A file under this folder takes the place of mithaq-admin's file of the same name, for every importer.
    mithaqAdmin(fileURLToPath(new URL('./src/components/mithaq/', import.meta.url))),
    // `mithaq generate screens` writes `files.ts` and `types.ts` beside the route files; neither is a route.
    tanstackStart({ router: { routeFileIgnorePattern: '^(files|types)\\.ts$' } }),
    viteReact(),
  ],
  environments: {
    ssr: {
      // `asas` and `mithaq` stay external: Vite bundles linked workspace packages by default, and bundling
      // would follow the drizzle adapter's `drizzle-kit/api-postgres` import, which must never be followed.
      // Both keys are needed: `resolve.external` is what dev reads, `build.rollupOptions.external` what the build reads.
      resolve: { external: ['asas', 'mithaq'] },
      build: { rollupOptions: { external: [/^asas$/, /^mithaq(\/|$)/] } },
    },
  },
})
