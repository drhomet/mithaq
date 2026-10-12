// The JSX loader is imported for its side effect; registry files load through dynamic import so it is registered first.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement, type ReactElement } from 'react'
import { asas } from 'asas'
import { ScreenContext, type ScreenState } from 'mithaq/admin/react'
import { fetchHttp } from 'mithaq'
import './tsx.ts'

const { Form } = await import('../registry/form.tsx')
const { ComponentsProvider, RouteError, checkComponents } = await import('../registry/components.tsx')
const { defaultComponents } = await import('../registry/default-components.tsx')
type Components = import('../registry/components.tsx').Components
type ControlsOf<L> = import('../registry/components.tsx').ControlsOf<L>
type ControlProps = import('../registry/control-props.ts').ControlProps

const screen = asas.targets.dashboard.client
const courses = screen.kayan.courses!
const t = (_key: string, fallback?: string) => fallback
const state: ScreenState = {
  t,
  locale: 'en',
  dir: 'ltr',
  screen,
  access: {},
  user: { name: 'Admin', email: 'admin@example.com' },
  client: async () => ({}),
  kayan: courses,
  record: null,
}
const form = () =>
  createElement(Form, {
    kayan: courses,
    client: { create: async () => ({}), update: async () => ({}), delete: async () => ({}) },
    value: { id: '0f1d8c2e-0000-4000-8000-000000000001', title: 'Tajweed' },
    t,
    locale: 'en',
    onDone: () => {},
  })
const drawn = (element: ReactElement) => renderToStaticMarkup(createElement(ScreenContext, { value: state }, element))
const formWith = (components: Components) => drawn(createElement(ComponentsProvider, { components }, form()))

test('a kind\'s control is replaced through the components map, and the replacement draws in place of the default', () => {
  assert.match(formWith(defaultComponents), /<input[^>]*id="courses-title"/, 'the default map draws the text box')
  const Mine = ({ id, value }: ControlProps) => createElement('output', { id, 'data-mine': '' }, String(value))
  const html = formWith({ ...defaultComponents, controls: { ...defaultComponents.controls, text: Mine } })
  assert.match(html, /<output id="courses-title" data-mine="">Tajweed<\/output>/, 'the project\'s control draws the title')
  assert.doesNotMatch(html, /<input[^>]*id="courses-title"/, 'and the default does not')
})

test('a kind the map leaves out is an error that names it, and a form drawn under no map says what to mount', () => {
  const { text: _text, ...rest } = defaultComponents.controls
  assert.throws(() => formWith({ controls: rest as Components['controls'] }), /components\.controls has no control for "text"/)
  assert.throws(() => drawn(form()), /ComponentsProvider/)
})

test('a kind the project\'s rukn brings is drawn by the control its map names for it, and a map without one is an error naming the kind and the field', async () => {
  const { language, swatches } = await import('./color-language.ts')
  const built = language.buildAsas({ http: [fetchHttp()], kayan: [swatches] })
  try {
    const kayan = built.targets.dashboard.client.kayan.swatches!
    const swatch = (components: Components) =>
      drawn(createElement(ComponentsProvider, { components }, createElement(Form, { kayan, client: { create: async () => ({}), update: async () => ({}), delete: async () => ({}) }, value: { id: 's1', color: '#c0ffee' }, t, locale: 'en', onDone: () => {} })))
    const ColorControl = ({ id, value }: ControlProps) => createElement('input', { id, type: 'color', value: String(value), readOnly: true })
    const controls = { ...defaultComponents.controls, color: ColorControl } satisfies ControlsOf<typeof language>
    assert.match(swatch({ ...defaultComponents, controls }), /<input id="swatches-color" type="color"[^>]*value="#c0ffee"/, 'the project\'s color control draws the field')
    assert.throws(() => swatch(defaultComponents), /components\.controls has no control for "color", the kind of field "color"/)
    // The app checks every screen it serves against its map at startup, so the gap fails there and not on the page that draws it.
    const client = built.targets.dashboard.client
    assert.throws(() => checkComponents({ client, components: defaultComponents }), /components\.controls has no control for kind "color", which swatches\.color is drawn with/)
    assert.doesNotThrow(() => checkComponents({ client, components: { ...defaultComponents, controls } }))
    assert.doesNotThrow(() => checkComponents({ client: screen, components: defaultComponents }), 'the template\'s own screen needs nothing past the defaults')
  } finally {
    await built.destroy()
  }
})

test('a route that throws draws the error\'s own words in an alert', () => {
  const html = renderToStaticMarkup(createElement(RouteError, { error: new Error('components.controls has no control for kind "color", which swatches.color is drawn with.') }))
  assert.match(html, /<div role="alert" data-route-error=""[^>]*>components\.controls has no control for kind &quot;color&quot;, which swatches\.color is drawn with\.<\/div>/)
})

test('an integer is drawn by whatever the map draws a number with, so replacing number replaces both', () => {
  const seats = { ...courses, fields: [{ name: 'seats', kind: 'integer', component: 'integer', cell: 'integer', rules: {} }] } as typeof courses
  const Counter = ({ id, value }: ControlProps) => createElement('output', { id, 'data-counter': '' }, String(value))
  const html = drawn(createElement(ComponentsProvider, { components: { ...defaultComponents, controls: { ...defaultComponents.controls, number: Counter } } }, createElement(Form, {
    kayan: seats,
    client: { create: async () => ({}), update: async () => ({}), delete: async () => ({}) },
    value: { id: 'c1', seats: 12 },
    t,
    locale: 'en',
    onDone: () => {},
  })))
  assert.match(html, /<output id="courses-seats" data-counter="">12<\/output>/)
})
