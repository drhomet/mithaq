// The JSX loader is imported for its side effect; registry files load through dynamic import so it is registered first.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement, type ReactElement } from 'react'
import { asas } from 'asas'
import { ScreenContext, type ScreenState } from 'mithaq/admin/react'
import './tsx.ts'

const { Form } = await import('../registry/form.tsx')
const { ComponentsProvider } = await import('../registry/components.tsx')
const { defaultComponents } = await import('../registry/default-components.tsx')
type Components = import('../registry/components.tsx').Components
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
