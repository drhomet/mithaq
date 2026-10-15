import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { mithaqAdmin } from 'mithaq/vite'
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  // An alias rather than `resolve.tsconfigPaths`, which applies only to files the nearest
  // tsconfig claims: the project's shells in the language package's `src/ui/` import `@/` too.
  // `^@/` and not `@`, so `@tanstack/*` is left alone.
  resolve: { alias: [{ find: /^@\//, replacement: fileURLToPath(new URL('./src/', import.meta.url)) }] },
  plugins: [
    tailwindcss(),
    // A file under this folder takes the place of mithaq-admin's file of the same name, for every importer.
    mithaqAdmin(fileURLToPath(new URL('./src/components/mithaq/', import.meta.url))),
    // `mithaq generate screens` writes `types.ts` and `files.ts` beside the route files, and neither is a route.
    tanstackStart({ router: { routeFileIgnorePattern: '^(files|types)\\.ts$' } }),
    viteReact(),
  ],
  // Behind the proxy that routes by Host: bound to the loopback address it targets, and answering
  // the public name in BETTER_AUTH_URL, which Vite refuses in a Host header unless named here.
  preview: { host: '127.0.0.1', allowedHosts: process.env.BETTER_AUTH_URL ? [new URL(process.env.BETTER_AUTH_URL).hostname] : [] },
  environments: {
    ssr: {
      // `asas` and `mithaq` stay external: the drizzle adapter imports `drizzle-kit/api-postgres`
      // behind a `webpackIgnore` comment Vite does not honour, and bundled, the build fails on
      // drizzle's optional peers. The dev server reads `resolve.external`, the build reads
      // `build.rollupOptions.external`, so both are set.
      resolve: { external: ['asas', 'mithaq'] },
      build: { rollupOptions: { external: [/^asas$/, /^mithaq(\/|$)/] } },
    },
  },
})
