// The DOM and the JSX loader are imported for their side effect before a page is reached.
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { mock, test } from 'node:test'
import { act, createElement } from 'react'
import '../../../packages/mithaq-admin/test/tsx.ts'
import { click, fire, mount, type as typeInto, window } from '../../../packages/mithaq-admin/test/dom.ts'

registerHooks({
  resolve: (specifier, context, next) =>
    // The root route imports its stylesheet as a URL, which only Vite resolves.
    specifier.endsWith('?url')
      ? { shortCircuit: true, url: 'data:text/javascript,export default ""' }
      : next(specifier, specifier === '@tanstack/router-core/isServer' ? { ...context, conditions: ['browser', ...context.conditions] } : context),
})
const { createRoot } = await import('react-dom/client')
const { Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } = await import('@tanstack/react-router')
const { NoOrganization } = await import('./no-organization.tsx')
const { scopes } = await import('./copy.ts')

const inFuture = new Date(Date.now() + 86_400_000).toISOString()

/** `NoOrganization` drawn on a page, with every request it makes answered by `answer` and kept in `sent`. */
const drawn = async ({ founds, answer, locale = 'en' }: { founds: boolean; answer: (path: string, body: unknown) => unknown; locale?: string }) => {
  const sent: { path: string; body?: unknown }[] = []
  const fetched = globalThis.fetch
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const path = String(url)
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    sent.push({ path, ...(body !== undefined && { body }) })
    return new Response(JSON.stringify(answer(path, body)), { headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  const root = createRootRoute({ beforeLoad: () => ({ dir: locale === 'ar' ? 'rtl' : 'ltr', locale, app: 'marketing.brand' }), component: () => createElement(Outlet) })
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ['/unauthorized'] }),
    routeTree: root.addChildren([createRoute({ getParentRoute: () => root, path: '/unauthorized', component: () => createElement(NoOrganization, { email: 'unplaced@example.com', founds }) })]),
  })
  const host = mount()
  const mounted = createRoot(host)
  await act(async () => {
    await router.load()
    mounted.render(createElement(RouterProvider, { router }))
  })
  // The reads it makes once drawn.
  await act(async () => new Promise((done) => setTimeout(done, 20)))
  return { host, sent, unmount: async () => { await act(async () => mounted.unmount()); globalThis.fetch = fetched } }
}

const reads = (path: string) =>
  path.endsWith('/organization/list-user-invitations')
    ? [{ id: 'inv-a', organizationName: 'Alpha', organizationNames: { en: 'Alpha', ar: 'ألفا' }, expiresAt: inFuture }, { id: 'inv-b', organizationName: 'Beta', expiresAt: inFuture }, { id: 'inv-old', organizationName: 'Gone', expiresAt: '2000-01-01T00:00:00.000Z' }]
    : path.endsWith('/get-session') ? { user: { name: 'Layla', email: 'unplaced@example.com' } } : {}

test('a person in no organization reads their invitations and declines one, and accepting one or founding one takes them in', async () => {
  const assigned = mock.method(window.location, 'assign', () => {})
  const { host, sent, unmount } = await drawn({ founds: true, answer: reads })
  try {
    const rows = () => [...host.querySelectorAll('[data-invitation]')].map((one) => one.getAttribute('data-invitation'))
    assert.deepEqual(rows(), ['inv-a', 'inv-b'], 'each pending invitation, and none that has expired')
    assert.ok(host.textContent?.includes('Alpha') && host.textContent.includes('Beta'), 'naming its organization')
    await act(async () => click(host.querySelector('[data-decline="inv-a"]')!))
    assert.deepEqual(sent.at(-1), { path: '/api/auth/user/organization/reject-invitation', body: { invitationId: 'inv-a' } })
    assert.deepEqual(rows(), ['inv-b'], 'a declined invitation leaves the list')
    await act(async () => click(host.querySelector('[data-accept="inv-b"]')!))
    assert.deepEqual(sent.at(-1), { path: '/api/auth/user/organization/accept-invitation', body: { invitationId: 'inv-b' } })
    assert.equal(assigned.mock.callCount(), 1, 'an accepted invitation takes them in')

    const box = host.querySelector<HTMLInputElement>('#new-organization')!
    assert.equal(box.value, scopes.auth!.workspaceOf!.en!.replace('{name}', 'Layla'), 'the new organization is named for them unless they change it')
    await act(async () => typeInto(box, 'Layla Tutoring'))
    const arabic = host.querySelector<HTMLInputElement>('#new-organization-ar')
    assert.ok(arabic, 'its name in each other locale is asked too')
    assert.equal(arabic!.required, false, 'and may be left empty, to fall back to the first')
    await act(async () => typeInto(arabic!, 'دروس ليلى'))
    await act(async () => fire(host.querySelector('[data-create-organization]')!, 'submit'))
    const made = sent.at(-1) as { path: string; body: { name: string; names: string; slug: string } }
    assert.equal(made.path, '/api/auth/user/organization/create')
    assert.equal(made.body.name, 'Layla Tutoring')
    assert.deepEqual(JSON.parse(made.body.names), { en: 'Layla Tutoring', ar: 'دروس ليلى' }, 'and sent in each locale')
    assert.match(made.body.slug, /^layla-tutoring-[a-z0-9]{6}$/, 'with a slug of its own')
    assert.equal(assigned.mock.callCount(), 2, 'and founding one takes them into it')
    assert.ok(host.textContent?.includes('unplaced@example.com'), 'the page names the address an administrator would invite')
  } finally {
    assigned.mock.restore()
    await unmount()
  }
})

test('an invitation names its organization in the reader\'s language', async () => {
  const { host, unmount } = await drawn({ founds: false, answer: reads, locale: 'ar' })
  try {
    assert.equal(host.querySelector('[data-invitation="inv-a"] bdi')?.textContent, 'ألفا', 'in Arabic where it has an Arabic name')
    assert.equal(host.querySelector('[data-invitation="inv-b"] bdi')?.textContent, 'Beta', 'and its one name where it has no other')
  } finally {
    await unmount()
  }
})

test('with one organization a person in none founds nothing here: they accept an invitation or ask for one', async () => {
  const { host, unmount } = await drawn({ founds: false, answer: reads })
  try {
    assert.equal(host.querySelector('[data-create-organization]'), null, 'no way to found an organization')
    assert.ok(host.querySelector('[data-accept="inv-a"]'), 'and still the invitations')
  } finally {
    await unmount()
  }
})
