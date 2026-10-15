// The DOM and the JSX loader are imported for their side effect before a page is reached.
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { test } from 'node:test'
import { act, createElement } from 'react'
import '../../../packages/mithaq-admin/test/tsx.ts'
import { mount } from '../../../packages/mithaq-admin/test/dom.ts'

registerHooks({
  resolve: (specifier, context, next) =>
    // The root route imports its stylesheet as a URL, which only Vite resolves.
    specifier.endsWith('?url')
      ? { shortCircuit: true, url: 'data:text/javascript,export default ""' }
      : next(specifier, specifier === '@tanstack/router-core/isServer' ? { ...context, conditions: ['browser', ...context.conditions] } : context),
})
const { createRoot } = await import('react-dom/client')
const { Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } = await import('@tanstack/react-router')
const { Route: Unauthorized, onwardOf } = await import('./routes/unauthorized.tsx')
const { scopes } = await import('./copy.ts')

const dashboard = { name: 'dashboard', path: '/dashboard' }
const portal = { name: 'portal', path: '/portal' }
const entered = { email: 'someone@example.com', organizations: [{ id: 'o', name: 'School' }] }

test('a person whose role opens one screen is sent there at once from a screen it does not open, and nowhere else', () => {
  assert.equal(onwardOf({ ...entered, screens: [portal] }), '/portal', 'one screen: straight there, with no page to read')
  assert.equal(onwardOf({ ...entered, screens: [dashboard, portal] }), undefined, 'several: they choose')
  assert.equal(onwardOf({ ...entered, screens: [] }), undefined, 'none: the page says why')
  assert.equal(onwardOf({ ...entered, screens: [portal], refused: { page: '/portal/courses', screen: portal } }), undefined, 'a page refused inside the one screen is said, so the person learns it is not theirs')
  assert.equal(onwardOf({ ...entered, screens: [portal], impersonating: 'Layla' }), undefined, 'and an impersonation is shown its bar, the only way out of it')
})

test('a person whose role opens several screens is asked where to go, each screen a button, in either locale', async () => {
  for (const locale of ['en', 'ar']) {
    const root = createRootRoute({ beforeLoad: () => ({ dir: locale === 'ar' ? 'rtl' : 'ltr', locale, app: 'marketing.brand' }), component: () => createElement(Outlet) })
    const router = createRouter({
      history: createMemoryHistory({ initialEntries: ['/unauthorized'] }),
      routeTree: root.addChildren([createRoute({ getParentRoute: () => root, path: '/unauthorized', loader: () => ({ ...entered, screens: [dashboard, portal] }), component: Unauthorized.options.component! })]),
    })
    const host = mount()
    const mounted = createRoot(host)
    await act(async () => {
      await router.load()
      mounted.render(createElement(RouterProvider, { router }))
    })
    assert.ok(host.textContent?.includes(scopes.auth!.unauthorizedDescription![locale]!), `it asks where to go in ${locale}`)
    assert.equal(scopes.auth!.unauthorizedDescription!.en, 'This page isn\'t part of your account. Where would you like to go?')
    const buttons = [...host.querySelectorAll('a[data-slot=button]')].map((one) => [one.getAttribute('href'), one.textContent])
    assert.deepEqual(buttons, [['/dashboard', scopes.screens!.dashboard![locale]], ['/portal', scopes.screens!.portal![locale]]], `each screen a button in ${locale}`)
    await act(async () => mounted.unmount())
  }
})
