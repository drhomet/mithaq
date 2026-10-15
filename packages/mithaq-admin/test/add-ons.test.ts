// A process of its own, so nothing another test loaded can stand in for what the defaults load.
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { after, test } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { defaultMaxBodyBytes, fetchHttp } from 'mithaq'
import { ScreenContext, type ScreenState } from 'mithaq/admin/react'
import './tsx.ts'
// The template's screens, which plain-language.ts borrows, sit beside a language that lays down rich text for its server,
// whose node packages bring Lexical's own utils; loaded first, so the hook sees only what the admin's pieces load.
import 'mithaq/rich-text'

// Registered after the JSX loader, so it runs first and sees every module the registry files below pull in.
const loaded: string[] = []
registerHooks({
  resolve: (specifier, context, next) => {
    const found = next(specifier, context)
    loaded.push(found.url)
    return found
  },
})

const { Form } = await import('../registry/form.tsx')
const { List } = await import('../registry/list.tsx')
const { ComponentsProvider, checkComponents } = await import('../registry/components.tsx')
const { defaultComponents } = await import('../registry/default-components.tsx')
const { language, notes } = await import('./plain-language.ts')
const built = language.buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes })], kayan: [notes] })
after(() => built.destroy())

test('a language with no rich text and no files starts, and draws its forms and lists, with defaultComponents alone and loads neither add-on', () => {
  const client = built.targets.dashboard.client
  const kayan = client.kayan.notes!
  assert.doesNotThrow(() => checkComponents({ client, components: defaultComponents }))
  const t = (_key: string, fallback?: string) => fallback
  const state: ScreenState = { t, locale: 'en', dir: 'ltr', screen: client, access: {}, user: { name: 'Admin', email: 'admin@example.com' }, client: async () => ({}), kayan, record: null }
  const drawn = (element: ReturnType<typeof createElement>) =>
    renderToStaticMarkup(createElement(ScreenContext, { value: state }, createElement(ComponentsProvider, { components: defaultComponents }, element)))
  const row = { id: 'n1', title: 'Groceries', pinned: true }
  assert.match(drawn(createElement(Form, { kayan, client: { create: async () => ({}), update: async () => ({}), delete: async () => ({}) }, value: row, t, locale: 'en', onDone: () => {} })), /<input[^>]*id="notes-title"/)
  const page = { docs: [row], hasNextPage: false, hasPrevPage: false, limit: 10, nextPage: null, page: 1, pagingCounter: 1, prevPage: null, totalDocs: 1, totalPages: 1 }
  assert.match(drawn(createElement(List, { kayan, page, query: {}, t, locale: 'en', onQuery: () => {}, href: (id: string) => `/notes/${id}`, newHref: '/notes/new' })), />Groceries</)
  const addOn = new Set(loaded.filter((url) => /\/@?lexical\/|\/registry\/(rich-text(?!-line\.ts)|upload|file-thumb)/.test(url)).map((url) => url.replace(/^.*\/node_modules\/|^.*\/registry\//, '')))
  assert.deepEqual([...addOn], [])
  assert.ok(loaded.some((url) => url.endsWith('/registry/default-components.tsx')), 'the hook saw the defaults load')
})
