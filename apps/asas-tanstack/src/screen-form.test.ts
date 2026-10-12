// The DOM and the JSX loader are imported for their side effect before the host file is reached.
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { test } from 'node:test'
import { act, createElement } from 'react'
import { asas } from 'asas'
import '../../../packages/mithaq-admin/test/tsx.ts'
import { click, fire, mount, type as typeInto, window } from '../../../packages/mithaq-admin/test/dom.ts'

// The router's `isServer` module resolves by condition, and Node's `node` says yes; resolve
// `browser` here, as Vite's browser build does.
registerHooks({
  resolve: (specifier, context, next) =>
    next(specifier, specifier === '@tanstack/router-core/isServer' ? { ...context, conditions: ['browser', ...context.conditions] } : context),
})
const { createRoot } = await import('react-dom/client')
const { Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } = await import('@tanstack/react-router')
const { ScreenForm } = await import('./screen-form.tsx')

const courses = asas.targets.dashboard.client.kayan.courses!
const t = (_key: string, fallback?: string) => fallback

const start = async (at: string) => {
  const client = {
    create: async (input: Record<string, unknown>) => ({ ...input, id: 'made' }),
    update: async (input: Record<string, unknown>) => input,
    delete: async () => ({}),
  }
  const root = createRootRoute({ component: () => createElement(Outlet) })
  const form = (value: Record<string, unknown> | null) => () =>
    createElement(ScreenForm, { kayan: courses, client, value, t, locale: 'en', edit: (id: string) => `/courses/${id}`, list: '/courses' })
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: [at] }),
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/courses', component: () => createElement('p', null, 'The list') }),
      createRoute({ getParentRoute: () => root, path: '/courses/new', component: form(null) }),
      createRoute({ getParentRoute: () => root, path: '/courses/$id', component: form({ id: 'made', title: 'Tajweed' }) }),
    ]),
  })
  const host = mount()
  const mounted = createRoot(host)
  await act(async () => {
    await router.load()
    mounted.render(createElement(RouterProvider, { router }))
  })
  return { host, router, unmount: () => act(async () => mounted.unmount()) }
}
const dialog = () => window.document.querySelector('[data-slot="alert-dialog-content"]')

test('a create lands on the new record\'s edit page', async () => {
  const { host, router, unmount } = await start('/courses/new')
  await act(async () => typeInto(host.querySelector('#courses-title')!, 'Tajweed'))
  await act(async () => fire(host.querySelector('form')!, 'submit'))
  await act(async () => new Promise((resolve) => setTimeout(resolve, 50)))
  assert.equal(router.state.location.pathname, '/courses/made', 'the host is on the row the create made')
  assert.equal(dialog(), null, 'and the move asked nothing, because the change it made was saved')
  await unmount()
})

test('leaving a form holding a change asks, and leaving a clean one does not', async () => {
  const clean = await start('/courses/made')
  await act(async () => void clean.router.navigate({ href: '/courses' }))
  assert.equal(clean.router.state.location.pathname, '/courses', 'a clean form is left at once')
  assert.equal(dialog(), null, 'without a question')
  await clean.unmount()

  const { host, router, unmount } = await start('/courses/made')
  await act(async () => typeInto(host.querySelector('#courses-title')!, 'Tajweed II'))
  await act(async () => void router.navigate({ href: '/courses' }))
  assert.equal(router.state.location.pathname, '/courses/made', 'a form holding a change is not left yet')
  const asked = dialog()
  assert.ok(asked?.textContent?.includes('You have unsaved changes. Leave without saving?'), 'the router block asks the discard question')

  await act(async () => click([...asked!.querySelectorAll('button')].find((one) => one.textContent === 'Cancel') as unknown as Element))
  assert.equal(router.state.location.pathname, '/courses/made', 'Cancel keeps the form')
  assert.equal((host.querySelector('#courses-title') as HTMLInputElement).value, 'Tajweed II', 'and the change in it')

  await act(async () => void router.navigate({ href: '/courses' }))
  await act(async () => click([...dialog()!.querySelectorAll('button')].find((one) => one.textContent === 'Discard changes') as unknown as Element))
  assert.equal(router.state.location.pathname, '/courses', 'Discard changes leaves')
  await unmount()
})
