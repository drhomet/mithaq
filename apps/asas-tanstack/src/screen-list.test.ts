import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { test } from 'node:test'
import { act, createElement } from 'react'
import { asas } from 'asas'
import '../../../packages/mithaq-admin/test/tsx.ts'
import { click, mount, window } from '../../../packages/mithaq-admin/test/dom.ts'

registerHooks({
  resolve: (specifier, context, next) =>
    next(specifier, specifier === '@tanstack/router-core/isServer' ? { ...context, conditions: ['browser', ...context.conditions] } : context),
})
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } = await import('@tanstack/react-router')
const { ScreenList, flatSearch } = await import('./screen-list.tsx')
const { ComponentsProvider } = await import('./components/mithaq/components.tsx')
const { defaultComponents: shipped } = await import('./components/mithaq/default-components.tsx')
const { richTextComponents } = await import('./components/mithaq/rich-text.tsx')
const { uploadComponents } = await import('./components/mithaq/upload.tsx')
// The template's language holds rich text and files, so a course's list draws with both add-ons spread in, as the router does.
const defaultComponents = {
  ...shipped,
  controls: { ...shipped.controls, ...richTextComponents.controls, ...uploadComponents.controls },
  cells: { ...shipped.cells, ...richTextComponents.cells, ...uploadComponents.cells },
}
const { ScreenContext } = await import('mithaq/admin/react')
const { askedFor } = await import('./screen-list.tsx')

const screen = asas.targets.dashboard.client
const courses = screen.kayan.courses!
const t = (_key: string, fallback?: string) => fallback
const state = { t, locale: 'en', dir: 'ltr' as const, screen, access: {}, user: { name: 'Admin', email: 'admin@example.com' }, client: async () => ({}) }
const docs = (page: number) => [
  { id: `c${page}a`, title: `Tajweed ${page}`, fee: 100, archived: false },
  { id: `c${page}b`, title: `Nahw ${page}`, fee: 200, archived: true },
]
const pageOf = (page: number) => ({ docs: docs(page), hasNextPage: true, hasPrevPage: page > 1, limit: 10, nextPage: page + 1, page, prevPage: page > 1 ? page - 1 : null, totalDocs: 40, totalPages: 4 })

const start = async (at: string) => {
  const found: Record<string, unknown>[] = []
  const ran: { operation: string; input: Record<string, unknown> }[] = []
  const queries = new QueryClient()
  const root = createRootRoute({ component: () => createElement(QueryClientProvider, { client: queries }, createElement(Outlet)) })
  const list = createRoute({
    getParentRoute: () => root,
    path: '/courses',
    validateSearch: askedFor,
    component: function Page() {
      const navigate = list.useNavigate()
      return createElement(ScreenContext, { value: state }, createElement(ScreenList, {
        props: {
          kayan: courses,
          t,
          locale: 'en',
          href: (id: string) => `/courses/${id}`,
          newHref: '/courses/new',
          operations: { deleteMany: true, updateMany: true, archive: true },
          screen: { refs: {}, kayan: courses, page: courses.pages.list as never },
        },
        raw: list.useSearch(),
        onQuery: (search: Record<string, string>) => void navigate({ search: search as never }),
        find: async (input: Record<string, unknown>) => {
          found.push(input)
          return pageOf(Number(input.page ?? 1))
        },
        run: async (operation: string, input: Record<string, unknown>) => void ran.push({ operation, input }),
      }))
    },
  })
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: [at] }),
    routeTree: root.addChildren([list, createRoute({ getParentRoute: () => root, path: '/courses/$id', component: () => createElement('p', null, 'A row') })]),
    ...flatSearch,
    Wrap: ({ children }) => createElement(ComponentsProvider, { components: defaultComponents }, children),
  })
  const host = mount()
  const mounted = createRoot(host)
  await act(async () => {
    await router.load()
    mounted.render(createElement(RouterProvider, { router }))
  })
  await settle()
  return { host, router, found, ran, unmount: () => act(async () => { mounted.unmount(); queries.clear() }) }
}
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 30)))
const titles = (host: Element) => [...host.querySelectorAll('tbody tr')].map((row) => row.querySelector('a')?.textContent)

test('a filtered, sorted page-2 URL is read into the one find it asks for, and back and forward land on the pages they left from the cache', async () => {
  const { host, router, found, unmount } = await start('/courses?where[title][like]=Taj&sort=-fee&page=2')
  assert.deepEqual(found, [{ where: { or: [{ and: [{ title: { like: 'Taj' } }] }] }, sort: '-fee', page: 2 }], 'the URL is the whole of what the list asks for, and no page size of the list\'s own, so the server\'s defaultLimit answers')
  assert.deepEqual(titles(host), ['Tajweed 2', 'Nahw 2'])

  await act(async () => void router.navigate({ href: '/courses?where[title][like]=Taj&sort=-fee&page=3' }))
  await settle()
  assert.equal(found.length, 2, 'the next page is one more read')
  assert.deepEqual(titles(host), ['Tajweed 3', 'Nahw 3'])

  await act(async () => router.history.back())
  await settle()
  assert.equal(router.state.location.search.page, '2', 'back is the page the URL held')
  assert.deepEqual(titles(host), ['Tajweed 2', 'Nahw 2'], 'drawn again')
  assert.equal(found.length, 2, 'from the cache, with no read')
  await act(async () => router.history.forward())
  await settle()
  assert.deepEqual(titles(host), ['Tajweed 3', 'Nahw 3'])
  assert.equal(found.length, 2, 'and forward too')
  await unmount()
})

test('returning to a list draws it from the cache at once, and a bulk action reads it again', async () => {
  const { host, router, found, ran, unmount } = await start('/courses')
  await act(async () => void router.navigate({ href: '/courses/c1a' }))
  assert.equal(host.textContent, 'A row')
  await act(async () => void router.navigate({ href: '/courses' }))
  assert.deepEqual(titles(host), ['Tajweed 1', 'Nahw 1'], 'the rows are there on the first render back')
  assert.equal(found.length, 1, 'with no read before them')

  const boxes = () => [...host.querySelectorAll('tbody [role="checkbox"]')]
  await act(async () => click(boxes()[0]! as unknown as Element))
  const remove = [...host.querySelectorAll('button')].find((one) => one.textContent === 'Delete')!
  await act(async () => click(remove as unknown as Element))
  await act(async () => click(window.document.querySelector('[data-button="confirm-operation"]')! as unknown as Element))
  await settle()
  assert.deepEqual(ran, [{ operation: 'deleteMany', input: { where: { id: { in: ['c1a'] } } } }], 'the bulk button ran over the ticked row')
  assert.equal(found.length, 2, 'and the list was read again')
  await unmount()
})

test('a row button with a when is drawn only on the rows it holds for', async () => {
  const { host, unmount } = await start('/courses')
  const rows = [...host.querySelectorAll('tbody tr')]
  const archive = async (row: Element) => {
    await act(async () => click(row.querySelector('[data-row-menu]')! as unknown as Element))
    return window.document.querySelector('[data-row-action="archive"]') !== null
  }
  assert.equal(await archive(rows[0]!), true, 'a course not archived yet can be')
  assert.equal(await archive(rows[1]!), false, 'an archived one offers no archive')
  await unmount()
})

test('a malformed or hostile URL is refused before any request', async () => {
  for (const search of [
    'where[__proto__][polluted]=1',
    'where[or][0][and][0][title][in][0][a][b][c]=1',
    'where[archiveReason][contains]=secret',
    'where[fee][contains]=x',
    'where[or][title][equals]=x',
    'where[and][title][equals]=x',
  ]) {
    const { host, found, unmount } = await start(`/courses?${search}`)
    assert.deepEqual(found, [], `${search} asks nothing`)
    assert.ok(host.querySelector('[data-mithaq-refused]'), `and says it was refused: ${search}`)
    assert.equal(({} as Record<string, unknown>).polluted, undefined, 'and no prototype was touched')
    await unmount()
  }
})
