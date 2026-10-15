// The DOM and the JSX loader are imported for their side effect before a page is reached.
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { test } from 'node:test'
import { act, createElement } from 'react'
import '../../../packages/mithaq-admin/test/tsx.ts'
import { mount } from '../../../packages/mithaq-admin/test/dom.ts'

// One organization by invitation, which the repository's own `organizations.ts` does not hold.
const invitationOnly = `data:text/javascript,${encodeURIComponent("export const organizations = 'one', showOrganization = true, signUp = 'invite', verifyEmail = true")}`
registerHooks({
  resolve: (specifier, context, next) =>
    // The root route imports its stylesheet as a URL, which only Vite resolves.
    specifier.endsWith('?url')
      ? { shortCircuit: true, url: 'data:text/javascript,export default ""' }
      : specifier === 'asas/organizations'
        ? { shortCircuit: true, url: invitationOnly }
        : next(specifier, specifier === '@tanstack/router-core/isServer' ? { ...context, conditions: ['browser', ...context.conditions] } : context),
})
const { createRoot } = await import('react-dom/client')
const { Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } = await import('@tanstack/react-router')
const landing = (await import('./routes/index.tsx')).Route.options.component!

test('by invitation, the landing page offers a visitor Sign in alone: no Get started leads to a page that only says accounts are made by invitation', async () => {
  const root = createRootRoute({ beforeLoad: () => ({ dir: 'ltr', locale: 'en', app: 'marketing.brand' }), component: () => createElement(Outlet) })
  const router = createRouter({ history: createMemoryHistory({ initialEntries: ['/'] }), routeTree: root.addChildren([createRoute({ getParentRoute: () => root, path: '/', component: landing })]) })
  const host = mount()
  const mounted = createRoot(host)
  await act(async () => {
    await router.load()
    mounted.render(createElement(RouterProvider, { router }))
  })
  const links = [...host.querySelectorAll('a')].map((one) => one.getAttribute('href'))
  assert.ok(links.includes('/auth/sign-in'), `it offers Sign in: ${links.join(', ')}`)
  assert.ok(!links.includes('/auth/sign-up'), `and no sign-up: ${links.join(', ')}`)
  await act(async () => mounted.unmount())
})
