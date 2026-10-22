// Drives the registry in a mounted DOM: renderToStaticMarkup attaches no handlers, so claims about onChange need a mounted tree.
// The DOM and the JSX loader are imported for their side effect, in that order, and every screen is imported dynamically after both.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { mock, test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { StrictMode, act, createElement, useLayoutEffect, useState, type ReactElement } from 'react'
import { asas } from 'asas'
import { defaultMaxBodyBytes, fetchHttp } from 'mithaq'
import { FormContext, ListContext, ScreenContext, useForm, useKayan, useRecord, type ScreenState } from 'mithaq/admin/react'
import './tsx.ts'
import { click, fire, mount, press, window, type as typeInto } from './dom.ts'

// TanStack Query is resolved from the cell that imports it, so the test's provider and the cell's hook are one module.
const queryHost = new URL('../../../templates/features/courses/enrollments/ui/session-cell.tsx', import.meta.url).href
registerHooks({
  resolve: (specifier, context, next) => (specifier === '@tanstack/react-query' ? next(specifier, { ...context, parentURL: queryHost }) : next(specifier, context)),
})
const { QueryClient, QueryClientProvider, timeoutManager } = (await import('@tanstack/react-query' as string)) as {
  QueryClient: new (options?: unknown) => { clear(): void; invalidateQueries(): Promise<void> }
  QueryClientProvider: (props: { client: unknown; children?: unknown }) => ReactElement
  timeoutManager: { setTimeoutProvider: (provider: Record<string, unknown>) => void }
}
// Each query arms a five-minute cache timer, which kept this file's process open for five minutes after its last test.
timeoutManager.setTimeoutProvider({
  setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms).unref(),
  clearTimeout,
  setInterval: (callback: () => void, ms: number) => setInterval(callback, ms).unref(),
  clearInterval,
})
const { createRoot } = await import('react-dom/client')
const { Form } = await import('../registry/form.tsx')
const { copyFile } = await import('../../../apps/asas-tanstack/src/copy.ts')
const { DiscardDialog } = await import('../registry/discard-dialog.tsx')
const { List } = await import('../registry/list.tsx')
const { Filters } = await import('../registry/list-filters.tsx')
const { findOf, readQuery, remembered, rulesOf, writeQuery } = await import('../registry/list-query.ts')
const { Pagination } = await import('../registry/list-pagination.tsx')
/** The zone the process started in, which a test that sets `TZ` assigns back. */
const homeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
const { withAddOns } = await import('./with-add-ons.ts')
// The template's language holds rich text and files, so its screens draw with both add-ons spread in, as its apps do.
const defaultComponents = withAddOns((await import('../registry/default-components.tsx')).defaultComponents, (await import('../registry/rich-text.tsx')).richTextComponents, (await import('../registry/upload.tsx')).uploadComponents)
const { ComponentsProvider } = await import('../registry/components.tsx')
const controls: Readonly<Record<string, import('../registry/control-props.ts').Control>> = defaultComponents.controls
// A template file imports the map as `mithaq-admin/components.tsx`, which resolves to the same module here; the second provider stands for the app's own map.
const { ComponentsProvider: AppComponents } = await import('mithaq-admin/components.tsx')
const appDefaults = withAddOns((await import('mithaq-admin/default-components.tsx')).defaultComponents, (await import('mithaq-admin/rich-text.tsx')).richTextComponents, (await import('mithaq-admin/upload.tsx')).uploadComponents)
const withComponents = (element: ReactElement) => createElement(ComponentsProvider, { components: defaultComponents }, createElement(AppComponents, { components: appDefaults }, element))
const { arm, clientOf } = await import('../registry/host/api.ts')
const cells: Readonly<Record<string, import('../registry/control-props.ts').Cell>> = defaultComponents.cells
const { CalloutNode } = await import('./callout-node.ts')
const confirmYes = async () => {
  const yes = window.document.querySelector('[data-button="confirm-operation"]')
  assert.equal(yes !== null, true, 'the click opened the app\'s own confirm')
  const asked = yes!.closest('[data-slot="alert-dialog-content"]')?.textContent ?? ''
  await act(async () => click(yes as unknown as Element))
  return asked
}
const { RelationshipControl, findByIds, titleFieldOf } = await import('../registry/relationship-control.tsx')
type FindApi = import('../registry/control-props.ts').FindApi
type ClientField = import('mithaq/admin').ClientField
type ClientKayan = import('mithaq/admin').ClientKayan
type PageClient = import('mithaq/admin').PageClient
type ComponentProps = import('mithaq/admin').ComponentProps
const { RecordPage } = await import('../../../templates/mithaq/src/ui/record-page.tsx')
const { AppShell } = await import('../../../templates/mithaq/src/ui/app-shell.tsx')
const { Dashboard, loader: dashboardLoader } = await import('../../../templates/asas/src/ui-dashboard/dashboard.tsx')
const { DeleteRole } = await import('../../../templates/features/roles/roles/ui/roles.tsx')
const { loader: membersLoader } = await import('../../../templates/asas/src/ui-dashboard/members.tsx')
const { RoleName } = await import('../../../templates/asas/src/ui-backoffice/role-cells.tsx')

const screen = asas.targets.dashboard.client
const kayans: ClientKayan[] = Object.values(screen.kayan)
const projectedCourses = screen.kayan.courses!
// The OTP field (`accessCode`) is left out here; it has its own mounted checks below.
const courses = { ...projectedCourses, fields: projectedCourses.fields.filter((one) => one.name !== 'accessCode') }
const sessions = screen.kayan.sessions!
const enrollments = screen.kayan.enrollments!

const fieldOf = (field: Partial<ClientField> & { name: string; kind: string }): ClientField => ({
  rules: {},
  component: field.kind,
  cell: field.kind,
  ...field,
})

/** Answers every key with the caller's fallback. */
const t = (_key: string, fallback?: string) => fallback

const activity = './src/ui-dashboard/activity.tsx#Activity'
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
const screenOf = (page: PageClient, kayan: ClientKayan = courses, refs: Record<string, unknown> = {}) => ({
  refs: { [screen.layouts.app!]: AppShell, [screen.layouts.record!]: RecordPage, ...refs } as never,
  kayan,
  page: page as Extract<PageClient, { page: unknown }>,
})
const recordPage = (main: unknown[], path = '/courses/x'): PageClient => ({ path, page: { shell: screen.layouts.app!, main: [{ layout: screen.layouts.record!, main } as never] } })
const plus = (page: PageClient | undefined, region: string, ...nodes: unknown[]): PageClient => {
  const tree = page as Extract<PageClient, { page: unknown }>
  const layout = (tree.page.main as unknown as Record<string, unknown[]>[])[0]!
  return { ...tree, page: { ...tree.page, main: [{ ...layout, [region]: [...(layout[region] ?? []), ...nodes] }] } } as never
}

// Round 3: forms and feedback. Each check reads the copy the app ships, in English. Imported here, before the first
// test is registered: a top-level await after one lets the runner finish those and close the window the rest draw in.
const { Toaster, toast } = await import('../registry/toast.tsx')
const { translator: appCopy } = await import('../../../apps/asas-tanstack/src/copy.ts')
const english = appCopy('en')
/** Every toast on screen, as `type: words`, cleared for the next check. */
const toasted = async () => {
  const said = [...window.document.querySelectorAll('[data-toast]')].map((one) => `${one.getAttribute('data-toast')}: ${one.textContent}`)
  await act(async () => void toast.dismiss())
  window.sessionStorage.removeItem('mithaq:toast')
  return said
}
const withToaster = (element: ReactElement) => createElement('div', null, element, createElement(Toaster, { closeLabel: 'Close' }))

test('the switch override reports a boolean', async () => {
  const reported: unknown[] = []
  const host = await render(createElement(controls.switch!, {
    field: fieldOf({ name: 'notifications', kind: 'checkbox', rules: {} }), kayan: courses,
    id: 'notifications', t, value: false, values: {}, setValue: () => {},
    readOnly: false, onChange: (next: unknown) => reported.push(next),
  }))
  await act(async () => click(host.querySelector('[role="switch"]') as Element))
  assert.deepEqual(reported, [true])
})

test('the radio override reports the selected option value', async () => {
  const reported: unknown[] = []
  const host = await render(createElement(controls.radio!, {
    field: fieldOf({ name: 'currency', kind: 'text', options: [
      { value: 'SAR', label: { en: 'Riyal', ar: 'ريال' } },
      { value: 'USD', label: { en: 'Dollar', ar: 'دولار' } },
    ] }), kayan: courses, id: 'currency', t, locale: 'en', value: 'SAR', values: {}, setValue: () => {},
    readOnly: false, onChange: (next: unknown) => reported.push(next),
  }))
  await act(async () => click([...host.querySelectorAll('[role="radio"]')][1] as Element))
  assert.ok(reported.length > 0 && reported.every((value) => value === 'USD'))
})

test('the toggle-group override reports one option value', async () => {
  const reported: unknown[] = []
  const host = await render(createElement(controls.toggleGroup!, {
    field: fieldOf({ name: 'currency', kind: 'text', options: [
      { value: 'SAR', label: { en: 'Riyal', ar: 'ريال' } }, { value: 'USD', label: { en: 'Dollar', ar: 'دولار' } },
    ] }), kayan: courses, id: 'currency', t, locale: 'en', value: 'SAR', values: {}, setValue: () => {},
    readOnly: false, onChange: (next: unknown) => reported.push(next),
  }))
  await act(async () => click([...host.querySelectorAll('button')].find((one) => one.textContent === 'Dollar') as Element))
  assert.ok(reported.length > 0 && reported.every((value) => value === 'USD'))
})

test('the select override reports the chosen option value', async () => {
  const reported: unknown[] = []
  const host = await render(createElement(controls.select!, {
    field: fieldOf({ name: 'currency', kind: 'text', options: [
      { value: 'SAR', label: { en: 'Riyal', ar: 'ريال' } }, { value: 'USD', label: { en: 'Dollar', ar: 'دولار' } },
    ] }), kayan: courses, id: 'currency', t, locale: 'en', value: 'SAR', values: {}, setValue: () => {},
    readOnly: false, onChange: (next: unknown) => reported.push(next),
  }))
  await act(async () => click(host.querySelector('[data-slot="select-trigger"]') as Element))
  await act(async () => click([...window.document.querySelectorAll('[data-slot="select-item"]')].find((one) => one.textContent?.includes('Dollar')) as unknown as Element))
  assert.ok(reported.length > 0 && reported.every((value) => value === 'USD'))
})

test('an optional select can return to empty after a choice, while a required select cannot', async () => {
  const reported: unknown[] = []
  const field = fieldOf({ name: 'currency', kind: 'text', options: [
    { value: 'SAR', label: { en: 'Riyal' } }, { value: 'USD', label: { en: 'Dollar' } },
  ] })
  function Pick({ required = false, readOnly = false }: { required?: boolean; readOnly?: boolean }) {
    const [value, setValue] = useState<unknown>(null)
    return createElement(controls.select!, {
      field: { ...field, rules: { required } }, kayan: courses, id: 'currency', t, locale: 'en', value,
      values: {}, setValue: () => {}, placeholder: 'Choose currency', readOnly,
      onChange: (next: unknown) => { reported.push(next); setValue(next) },
    })
  }
  const host = await render(createElement(Pick))
  const choose = async (label: string) => {
    await act(async () => click(host.querySelector('[data-slot="select-trigger"]')!))
    const item = [...window.document.querySelectorAll('[data-slot="select-item"]')].find((one) => one.textContent === label)
    assert.ok(item, `the select offers ${label}`)
    await act(async () => click(item as unknown as Element))
  }
  await choose('Dollar')
  await choose('Clear')
  assert.deepEqual(reported, ['USD', null])
  assert.equal(host.querySelector('[data-slot="select-trigger"]')!.textContent, 'Choose currency')
  const required = await render(createElement(Pick, { required: true }))
  await act(async () => click(required.querySelector('[data-slot="select-trigger"]')!))
  assert.deepEqual([...window.document.querySelectorAll('[data-slot="select-item"]')].map((one) => one.textContent), ['Riyal', 'Dollar'])
  const locked = await render(createElement(Pick, { readOnly: true }))
  assert.equal((locked.querySelector('[data-slot="select-trigger"]') as HTMLButtonElement).disabled, true)
})

test('the native-select override is the select itself, one trigger and one border, and reports a string option', async () => {
  const reported: unknown[] = []
  const host = await render(createElement(controls.nativeSelect!, {
    field: fieldOf({ name: 'currency', kind: 'text', options: [
      { value: 'SAR', label: { en: 'Riyal', ar: 'ريال' } }, { value: 'USD', label: { en: 'Dollar', ar: 'دولار' } },
    ] }), kayan: courses, id: 'currency', t, locale: 'en', value: 'SAR', values: {}, setValue: () => {},
    readOnly: false, onChange: (next: unknown) => reported.push(next),
  }))
  assert.equal(controls.nativeSelect, controls.select, 'the two names are one control')
  assert.equal(host.querySelector('select'), null, 'and no native box, whose own border differs from every other box of the form')
  await act(async () => click(host.querySelector('[data-slot="select-trigger"]') as Element))
  await act(async () => click([...window.document.querySelectorAll('[data-slot="select-item"]')].find((one) => one.textContent?.includes('Dollar')) as unknown as Element))
  assert.ok(reported.length > 0 && reported.every((value) => value === 'USD'))
})

test('the slider override reads number bounds and reports a number', async () => {
  const reported: unknown[] = []
  const host = await render(createElement(controls.slider!, {
    field: fieldOf({ name: 'level', kind: 'number', rules: { min: 1, max: 5 } }), kayan: courses,
    id: 'level', t, value: 3, values: {}, setValue: () => {},
    readOnly: false, onChange: (next: unknown) => reported.push(next),
  }))
  await act(async () => press(host.querySelector('input[type="range"]') as Element, 'ArrowRight'))
  assert.ok(reported.length > 0 && reported.every((value) => value === 4))
})

test('an unset slider draws no thumb and reports nothing until it is moved, like every other control holding nothing', async () => {
  const reported: unknown[] = []
  const props = {
    field: fieldOf({ name: 'level', kind: 'number', rules: { min: 1, max: 5 } }), kayan: courses,
    id: 'level', t, values: {}, setValue: () => {},
    readOnly: false, onChange: (next: unknown) => reported.push(next),
  }
  const unset = await render(createElement(controls.slider!, { ...props, value: null }))
  assert.equal(unset.querySelector('[data-slot="slider"]')?.hasAttribute('data-empty'), true, 'nothing held is drawn as nothing held')
  assert.deepEqual(reported, [], 'and nothing is reported for it')
  const held = await render(createElement(controls.slider!, { ...props, value: 3 }))
  assert.equal(held.querySelector('[data-slot="slider"]')?.hasAttribute('data-empty'), false)
})

test('an unset slider says so to a screen reader, shows its thumb to the keyboard, and a key that leaves it at min reports min', async () => {
  const reported: unknown[] = []
  const props = {
    field: fieldOf({ name: 'level', kind: 'number', rules: { min: 1, max: 5 } }), kayan: courses,
    id: 'level', t, values: {}, setValue: () => {},
    readOnly: false, onChange: (next: unknown) => reported.push(next),
  }
  const unset = await render(createElement(controls.slider!, { ...props, value: null }))
  const input = unset.querySelector('input[type="range"]') as Element
  assert.equal(input.getAttribute('aria-valuetext'), 'unset', 'the value a screen reader hears is that there is none, not the min it is drawn at')
  const hidden = unset.querySelector('[data-slot="slider"]')!.className
  assert.ok(hidden.includes('**:data-[slot=slider-thumb]:not-has-focus-visible:opacity-0'), 'the thumb is hidden only while no keyboard focus is inside it')
  assert.ok(!hidden.includes('**:data-[slot=slider-thumb]:opacity-0'), 'and never hidden outright')
  assert.ok(unset.querySelector('[data-slot="slider-thumb"] input[type="range"]'), 'the focus that shows it is the range input inside the thumb')
  await act(async () => press(input, 'Home'))
  assert.deepEqual(reported, [1], 'Home on an unset slider drawn at min reports min, which the slider itself treats as no change')
  reported.length = 0
  const pressed = await render(createElement(controls.slider!, { ...props, value: null }))
  await act(async () => fire(pressed.querySelector('[data-slot="slider"]')!, 'pointerdown'))
  assert.deepEqual(reported, [1], 'and so does a first press, where the pointer lands on the min it is drawn at')
  reported.length = 0
  await act(async () => press(pressed.querySelector('input[type="range"]')!, 'Tab'))
  assert.deepEqual(reported, [], 'a key the slider does not move on reports nothing')

  const held = await render(createElement(controls.slider!, { ...props, value: 3 }))
  assert.notEqual(held.querySelector('input[type="range"]')!.getAttribute('aria-valuetext'), 'unset', 'a held value is read as itself')
})

test('the otp override reports exactly the configured digit count', async () => {
  const reported: unknown[] = []
  const host = await render(createElement(controls.otp!, {
    field: fieldOf({ name: 'code', kind: 'text', rules: { maxLength: 4 } }), kayan: courses,
    id: 'code', t, value: '', values: {}, setValue: () => {},
    readOnly: false, onChange: (next: unknown) => reported.push(next),
  }))
  try {
    await act(async () => typeInto(host.querySelector('input')!, '1234'))
    assert.ok(reported.includes('1234'))
  } finally {
    await act(async () => mounted?.unmount())
    mounted = undefined
  }
})

test('the combobox override reports a chosen text option', async () => {
  const reported: unknown[] = []
  const host = await render(createElement(controls.combobox!, {
    field: fieldOf({ name: 'currency', kind: 'text', options: [
      { value: 'SAR', label: { en: 'Riyal', ar: 'ريال' } }, { value: 'USD', label: { en: 'Dollar', ar: 'دولار' } },
    ] }), kayan: courses, id: 'currency', t, locale: 'en', value: 'SAR', values: {}, setValue: () => {},
    readOnly: false, onChange: (next: unknown) => reported.push(next),
  }))
  await act(async () => click(host.querySelector('[role="combobox"]') as Element))
  await act(async () => click([...window.document.querySelectorAll('[role="option"]')].find((one) => one.textContent?.includes('Dollar')) as unknown as Element))
  assert.ok(reported.length > 0 && reported.every((value) => value === 'USD'))
})

test('each named control reaches valuesOf with its kind value', async () => {
  const expected: Record<string, [string, unknown]> = {
    switch: ['notifications', true], radio: ['delivery', 'recorded'], toggleGroup: ['audience', 'advanced'],
    select: ['currency', 'USD'], nativeSelect: ['venue', 'campus'], slider: ['level', 2],
    otp: ['accessCode', '123456'], combobox: ['format', 'lecture'],
  }
  for (const [component, [name, wanted]] of Object.entries(expected)) {
    const source = component === 'nativeSelect' || component === 'combobox' ? sessions : component === 'otp' ? projectedCourses : courses
    const field = source.fields.find((one) => one.name === name)!
    const written: Record<string, unknown>[] = []
    const host = await render(createElement(Form, {
      kayan: { ...source, fields: [field] },
      client: { create: async (input: Record<string, unknown>) => { written.push(input); return {} }, update: async () => ({}), delete: async () => ({}) },
      value: null, t, locale: 'en', onDone: () => {},
    }))
    await act(async () => {
      if (component === 'switch') click(host.querySelector('[role="switch"]') as Element)
      else if (component === 'radio') click([...host.querySelectorAll('[role="radio"]')][1] as Element)
      else if (component === 'toggleGroup') click([...host.querySelectorAll('button')].find((one) => one.textContent === 'Advanced') as Element)
      else if (component === 'slider') press(host.querySelector('input[type="range"]') as Element, 'ArrowRight')
      else if (component === 'otp') typeInto(host.querySelector('input')!, '123456')
      else click(host.querySelector(component === 'combobox' ? '[role="combobox"]' : '[data-slot="select-trigger"]') as Element)
    })
    if (component === 'select' || component === 'nativeSelect' || component === 'combobox') {
      const shown = { select: 'US dollar', nativeSelect: 'Campus', combobox: 'Lecture' }[component]
      await act(async () => click([...window.document.querySelectorAll(component === 'combobox' ? '[role="option"]' : '[data-slot="select-item"]')]
        .find((one) => one.textContent?.includes(shown)) as unknown as Element))
    }
    await act(async () => fire(host.querySelector('form')!, 'submit'))
    assert.equal(written[0]?.[name], wanted, `${component} writes ${name} as its kind value`)
  }
})

// The previous tree is unmounted first: popovers, selects and dialogs render into a portal on the body, so two trees would share one picker list.
let mounted: ReturnType<typeof createRoot> | undefined
const render = async (element: ReactElement, over: Partial<ScreenState> = {}) => {
  const previous = mounted
  if (previous) await act(async () => previous.unmount())
  const host = mount()
  const root = createRoot(host)
  mounted = root
  await act(async () => {
    root.render(createElement(ScreenContext, { value: { ...state, ...over } }, withComponents(element)))
  })
  return host
}

/** What an open popover shows; its content is portaled to the document body, not the host. */
const opened = () => window.document.querySelector('[data-slot="combobox-content"]')

/** Longer than the 300 ms debounce of the picker and the search box. */
const debounced = async () => {
  await act(async () => {
    await sleep(400)
  })
}

// A read naming `id in` answers only those rows, as the store does, so hydration and cell reads differ from a page read.
const fakeApi = (
  rowsByTarget: Record<string, readonly Record<string, unknown>[]>,
  options: { hasNextPage?: boolean; silent?: boolean } = {},
) => {
  const calls: { target: string; input: Record<string, unknown> }[] = []
  const api: FindApi = Object.fromEntries(
    Object.entries(rowsByTarget).map(([target, rows]) => [
      target,
      {
        find: async (input: Record<string, unknown>) => {
          calls.push({ target, input })
          // Refused past the read cap that an HTTP read of many rows is held to.
          if (typeof input.limit === 'number' && input.limit > screen.maxLimit) throw new Error(`limit ${input.limit} is past the HTTP read cap`)
          // A read that never settles is what a cell mid-flight looks like.
          if (options.silent) await new Promise(() => {})
          const where = input.where as { id?: { in?: readonly string[]; not_in?: readonly string[] } } | undefined
          const wanted = where?.id?.in
          // `not_in` is honoured as the store does: a picker re-reads after every pick and must not offer the row just chosen.
          const kept = where?.id?.not_in
          const docs = wanted
            ? rows.filter((row) => wanted.includes(String(row.id)))
            : kept
              ? rows.filter((row) => !kept.includes(String(row.id)))
              : rows
          return { docs, hasNextPage: options.hasNextPage === true, nextPage: options.hasNextPage === true ? 2 : null }
        },
      },
    ]),
  )
  return { api, calls }
}

const drive = async (host: HTMLElement, kind: string) => {
  if (kind === 'checkbox') {
    // The app's checkbox is a `role="checkbox"` button and renders its hidden native input only inside a form.
    const box = host.querySelector('[role="checkbox"]')!
    await act(async () => {
      click(box as unknown as Element)
    })
    return
  }
  if (kind === 'relationship') {
    // Named by the primitive's slot, not as the first button, because the combobox draws its trigger first.
    const clear = host.querySelector('[data-slot="combobox-clear"]')
    if (clear) {
      await act(async () => {
        click(clear as unknown as Element)
      })
    }
    return
  }
  if (kind === 'date' || kind === 'datetime') {
    // A calendar over no held day opens on today.
    await act(async () => click(host.querySelector('button')!))
    const today = window.document.querySelector('[data-today] button')
    if (today) await act(async () => click(today as unknown as Element))
    if (kind === 'datetime') await typeTime(host, '03:04')
    return
  }
  const field = host.querySelector('textarea') ?? host.querySelector('input')!
  await act(async () => {
    typeInto(field, kind === 'number' ? '7' : 'typed')
  })
}

const now = new Date()
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

/** A moment's time of day as its field holds it, `HH:MM` on the 24-hour clock, or `''` while half typed. */
const timeOf = (root: ParentNode) => root.querySelector('[data-time-field]')?.getAttribute('data-value') ?? undefined
/** A segment of a moment's time of day: `hours`, `minutes` or `period`. */
const timeSegment = (root: ParentNode, name: string) => root.querySelector(`[data-time-field] [data-segment="${name}"]`) as unknown as HTMLInputElement
/** Types `HH:MM` on the 24-hour clock into a moment's field as a person would, hours then minutes then AM or PM; `''` clears it. */
const typeTime = async (root: ParentNode, text: string) => {
  const segment = (name: string) => timeSegment(root, name) as unknown as Element
  if (text === '') return void (await act(async () => void press(segment('minutes'), 'Backspace')))
  const [hours = 0, minutes = 0] = text.split(':').map(Number)
  const twelve = segment('period') !== null
  await act(async () => typeInto(segment('hours'), String(twelve ? hours % 12 || 12 : hours).padStart(2, '0')))
  await act(async () => typeInto(segment('minutes'), String(minutes).padStart(2, '0')))
  if (twelve && segment('period').getAttribute('data-period') !== (hours >= 12 ? 'PM' : 'AM')) await act(async () => click(segment('period')))
}

/** What each kind's control reports for the edit above, as `update` takes it: a number as a number, a moment as a `Date`, a day as its ISO string; nothing on the wire coerces them. The relationship's clear reports `null`. */
const reportedFor: Record<string, unknown> = {
  text: 'typed',
  email: 'typed',
  number: 7,
  datetime: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 3, 4),
  date: today,
  checkbox: true,
  textArray: ['typed'],
  relationship: null,
}

test('26. no control reports a change while it is read-only, and every writable one reports the value its kind is written as while it is not', async () => {
  // Both read-only and editable are driven: a step that drove only read-only would pass on a control that reports nothing.
  // A join leaf is left out: it edits no value of this row, so there is nothing to drive.
  for (const kind of ['text', 'email', 'number', 'checkbox', 'datetime', 'date', 'textArray', 'uuid', 'relationship']) {
    for (const readOnly of [true, false]) {
      const reported: unknown[] = []
      const host = await render(
        createElement(controls[kind]!, {
          values: {}, setValue: () => {},
          field: { name: 'probe', kind, rules: {}, relationTo: 'courses' } as never,
          kayan: courses,
          id: `probe-${kind}`,
          t,
          value: kind === 'checkbox' ? false : kind === 'textArray' ? ['one'] : 'held',
          readOnly,
          onChange: (next: unknown) => reported.push(next),
        }),
      )
      await drive(host, kind)
      if (readOnly) {
        assert.deepEqual(reported, [], `the read-only ${kind} control reports nothing`)
      } else if (kind === 'uuid') {
        assert.deepEqual(reported, [], 'the uuid control reports nothing even when the form says it may')

      } else {
        assert.equal(reported.length, 1, `the writable ${kind} control reports the edit, so the read-only half is not vacuous`)
        // The value, not only the count: a number control reporting the string `"7"` is a 400 on every save, since nothing coerces it.
        assert.deepEqual(reported[0], reportedFor[kind], `and the ${kind} control reports the value its kind is written as`)
      }
    }
  }
})

test('26b. a json box reports what its text parses to, nothing for an emptied box, and text that is no JSON as a value no save takes, keeping the text as typed', async () => {
  const reported: unknown[] = []
  const Probe = () => {
    const [value, setValue] = useState<unknown>({ a: 1 })
    return createElement(controls.json!, {
      values: {}, setValue: () => {}, field: { name: 'meta', kind: 'json', rules: {} } as never, kayan: courses, id: 'meta', t, value, readOnly: false,
      onChange: (next: unknown) => (reported.push(next), setValue(next)),
    })
  }
  const host = await render(createElement(Probe))
  const box = host.querySelector('textarea')!
  await act(async () => typeInto(box, '{"a": [1, "two", null]}'))
  assert.deepEqual(reported.at(-1), { a: [1, 'two', null] })
  assert.equal(box.value, '{"a": [1, "two", null]}', 'text that parses is left as typed, not rewritten under the caret')
  await act(async () => typeInto(box, '{"a": '))
  assert.equal(typeof reported.at(-1), 'symbol', 'no JSON value, so a save is refused and a draft\'s sends no key')
  assert.equal(box.value, '{"a": ', 'and the text stays for the person to finish')
  await act(async () => typeInto(box, '  '))
  assert.equal(reported.at(-1), null)
  await act(async () => typeInto(box, '"text"'))
  assert.equal(reported.at(-1), 'text')
})

test('178d. a date picks off the calendar in the viewer\'s locale and writes the day the column holds; a moment keeps its time when its day changes and its day when its time does', async () => {
  const picker = async (kind: string, value: unknown, locale = 'en') => {
    const reported: unknown[] = []
    const host = await render(createElement(controls[kind]!, {
      values: {}, setValue: () => {}, value, field: fieldOf({ name: 'at', kind }), kayan: courses, id: 'at', t, locale,
      readOnly: false, onChange: (next: unknown) => reported.push(next),
    }))
    return { host, reported }
  }
  const day = await picker('date', '2026-09-21', 'ar')
  const button = day.host.querySelector('button#at')!
  assert.ok(button.textContent!.includes('سبتمبر'), `the button names the held day in Arabic: ${button.textContent}`)
  await act(async () => click(button as unknown as Element))
  const calendar = window.document.querySelector('[data-slot="calendar"]')
  assert.ok(calendar, 'the button opens the calendar')
  assert.equal(calendar!.querySelector('[data-day="2026-09-21"]')?.hasAttribute('data-selected'), true, 'on the held day')
  assert.ok(calendar!.textContent!.includes('سبتمبر'), 'and names its month in Arabic')
  await act(async () => click(calendar!.querySelector('[data-day="2026-09-24"] button') as unknown as Element))
  assert.deepEqual(day.reported, ['2026-09-24'], 'a picked day writes the yyyy-mm-dd the column holds')
  assert.equal(window.document.querySelector('[data-slot="calendar"]'), null, 'and the calendar closes')

  const moment = await picker('datetime', new Date(2026, 0, 2, 3, 4))
  assert.equal(timeOf(moment.host), '03:04', 'the time box holds the time of day on the reader\'s clock')
  await act(async () => click(moment.host.querySelector('button#at') as unknown as Element))
  await act(async () => click(window.document.querySelector('[data-day="2026-01-05"] button') as unknown as Element))
  assert.equal((moment.reported[0] as Date).getTime(), new Date(2026, 0, 5, 3, 4).getTime(), 'a new day keeps the time held')
  await typeTime(moment.host, '10:30')
  assert.equal((moment.reported.at(-1) as Date).getTime(), new Date(2026, 0, 2, 10, 30).getTime(), 'and a new time keeps the day held')
})

test('178e. a moment holds a value only when both its day and its time are set, and clearing either clears it', async () => {
  const reported: unknown[] = []
  const moments = () => reported as Array<Date | null>
  const Held = () => {
    const [value, setValue] = useState<unknown>(undefined)
    return createElement(controls.datetime!, {
      values: {}, setValue: () => {}, value, field: fieldOf({ name: 'at', kind: 'datetime' }), kayan: courses, id: 'at', t, locale: 'en',
      readOnly: false, onChange: (next: unknown) => (reported.push(next), setValue(next)),
    })
  }
  const host = await render(createElement(Held))
  const time = () => timeSegment(host, 'hours')
  const button = () => host.querySelector('button#at')!
  const pickToday = async () => {
    await act(async () => click(button() as unknown as Element))
    await act(async () => click(window.document.querySelector('[data-today] button') as unknown as Element))
  }
  const at = (hours: number, minutes: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes).getTime()
  assert.equal(time().disabled, true, 'the time box waits for a day')
  assert.equal(time().hasAttribute('name'), false, 'and carries no name, so a form posts nothing for it')
  await pickToday()
  assert.deepEqual(reported, [], 'a day alone writes nothing')
  assert.equal(time().disabled, false, 'and opens the time box')
  assert.ok(button().textContent!.includes(String(now.getFullYear())), 'while the button keeps the day picked')
  assert.equal(button().getAttribute('aria-labelledby')?.split(' ').map((one) => host.querySelector(`[id="${one}"]`)?.textContent).join(' '), `at ${button().textContent}`, 'and its name is the label and the day')
  assert.equal(host.querySelector('[data-time-field]')?.getAttribute('aria-label'), 'at Time', 'the time box has a name of its own')
  await typeTime(host, '10:30')
  assert.equal(moments()[0]!.getTime(), at(10, 30), 'a day and a time write the local moment')
  await typeTime(host, '')
  assert.equal(reported[1], null, 'clearing the time clears the value, never midnight')
  assert.equal(reported.length, 2)
  assert.ok(button().textContent!.includes(String(now.getFullYear())), 'and the day stays on the button')
  await typeTime(host, '08:15')
  assert.equal(moments()[2]!.getTime(), at(8, 15), 'a time typed again writes on the day kept')
  await pickToday()
  assert.equal(reported[3], null, 'picking the held day again clears the value')
  assert.equal(time().disabled, true, 'and shuts the time box')
  assert.equal(button().textContent, 'Pick a date')
})

test('178f. picking the held day again clears a date, and a date picked in any zone writes its own day', async () => {
  const reported: unknown[] = []
  const zone = process.env.TZ
  try {
    for (const tz of ['Pacific/Auckland', 'America/Los_Angeles']) {
      process.env.TZ = tz
      reported.length = 0
      const host = await render(createElement(controls.date!, {
        values: {}, setValue: () => {}, value: '2026-09-21', field: fieldOf({ name: 'at', kind: 'date' }), kayan: courses, id: 'at', t, locale: 'en',
        readOnly: false, onChange: (next: unknown) => reported.push(next),
      }))
      await act(async () => click(host.querySelector('button#at') as unknown as Element))
      await act(async () => click(window.document.querySelector('[data-day="2026-09-24"] button') as unknown as Element))
      await act(async () => click(host.querySelector('button#at') as unknown as Element))
      await act(async () => click(window.document.querySelector('[data-day="2026-09-21"] button') as unknown as Element))
      assert.deepEqual(reported, ['2026-09-24', null], `in ${tz} a picked day is its own day and the held day clears`)
    }
  } finally {
    if (zone === undefined) delete process.env.TZ
    else process.env.TZ = zone
  }
})

test('178g. a filter on a date or a moment picks its value off the same calendar and sends the shape it always sent, and a text filter follows its text\'s direction', async () => {
  const filtering = async (kind: string) => {
    const reported: unknown[] = []
    const host = await render(createElement(Filters, {
      paths: [{ path: 'at', kind, kayan: courses, field: fieldOf({ name: 'at', kind }) }], value: undefined, onChange: (where: unknown) => reported.push(where), t, locale: 'en',
    }))
    return { host, reported }
  }
  const text = await filtering('text')
  assert.equal(text.host.querySelector('input[aria-label="value"]')?.getAttribute('dir'), 'auto', 'a text filter\'s box follows its text')
  for (const kind of ['date', 'datetime']) {
    const { host, reported } = await filtering(kind)
    assert.equal(host.querySelector('input[type="date"], input[type="datetime-local"]'), null, `a ${kind} filter draws no browser box`)
    await act(async () => click(host.querySelector('button#filter-0-0') as unknown as Element))
    await act(async () => click(window.document.querySelector('[data-today] button') as unknown as Element))
    if (kind === 'datetime') await typeTime(host, '09:30')
    await act(async () => sleep(400))
    assert.deepEqual(reported.map((one) => JSON.stringify(one)), [JSON.stringify({ or: [{ and: [{ at: { equals: kind === 'date' ? today : new Date(`${today}T09:30`).toISOString() } }] }] })], `a ${kind} filter sends ${kind === 'date' ? 'the day' : 'the local moment as an instant'}`)
  }
})

test('180. a moment filter picked at 09:30 in a UTC+3 browser asks for 06:30Z, its link reads back as 09:30 there, an old link with no zone is read on the same clock, and a day filter is unchanged', async () => {
  try {
    process.env.TZ = 'Asia/Riyadh'
    const here = new Date()
    const day = `${here.getFullYear()}-${String(here.getMonth() + 1).padStart(2, '0')}-${String(here.getDate()).padStart(2, '0')}`
    const filtering = async (kind: string, value?: unknown) => {
      const reported: unknown[] = []
      const path = { path: 'at', kind, kayan: courses, field: fieldOf({ name: 'at', kind }) }
      const host = await render(createElement(Filters, { paths: [path], value: value as never, onChange: (where: unknown) => reported.push(where), t, locale: 'en' }))
      return { host, reported, rules: { paths: [path], sortable: [], maxLimit: 100 } }
    }
    const picked = async (kind: string) => {
      const filter = await filtering(kind)
      await act(async () => click(filter.host.querySelector('button#filter-0-0') as unknown as Element))
      await act(async () => click(window.document.querySelector('[data-today] button') as unknown as Element))
      if (kind === 'datetime') await typeTime(filter.host, '09:30')
      await act(async () => sleep(400))
      return filter
    }
    const asked = (rules: { paths: never[]; sortable: never[]; maxLimit: number }, search: URLSearchParams) =>
      JSON.stringify(findOf({ kayan: courses, query: readQuery(search, rules) }).where)

    const moment = await picked('datetime')
    const instant = `${day}T06:30:00.000Z`
    assert.deepEqual(moment.reported, [{ or: [{ and: [{ at: { equals: instant } }] }] }], '09:30 at UTC+3 is sent as the instant 06:30Z, which is the row stored at 06:30Z')
    const link = new URLSearchParams(writeQuery({ where: moment.reported[0] as never }))
    assert.equal(link.get('where[or][0][and][0][at][equals]'), instant, 'and the link carries that instant')
    assert.equal(asked(moment.rules as never, link), JSON.stringify({ or: [{ and: [{ at: { equals: instant } }] }] }), 'which is what the list asks for')

    const restored = await filtering('datetime', readQuery(link, moment.rules as never).where)
    assert.equal(timeOf(restored.host), '09:30', 'the link read back draws 09:30 in the time box')
    assert.ok(restored.host.querySelector('button#filter-0-0')?.textContent?.includes(String(here.getFullYear())), 'on the day it was picked')

    const old = new URLSearchParams(`where[or][0][and][0][at][equals]=${day}T09:30`)
    assert.equal(asked(moment.rules as never, old), JSON.stringify({ or: [{ and: [{ at: { equals: instant } }] }] }), 'a link written before the fix, with no zone, asks for the same instant, read on the reader\'s own clock')
    const reopened = await filtering('datetime', readQuery(old, moment.rules as never).where)
    assert.equal(timeOf(reopened.host), '09:30', 'and draws the same 09:30')

    const calendar = await picked('date')
    assert.deepEqual(calendar.reported, [{ or: [{ and: [{ at: { equals: day } }] }] }], 'a day filter still sends the calendar day')
    const dayLink = new URLSearchParams(writeQuery({ where: calendar.reported[0] as never }))
    assert.equal(asked(calendar.rules as never, dayLink), JSON.stringify({ or: [{ and: [{ at: { equals: day } }] }] }), 'and its link asks for that day, untouched')
  } finally {
    process.env.TZ = homeZone
  }
})

test('180b. moments typed into an in filter are sent as instants on the viewer\'s clock, and the box keeps what was typed while the link comes back with their zone', async () => {
  try {
    process.env.TZ = 'Asia/Riyadh'
    const path = { path: 'at', kind: 'datetime', kayan: courses, field: fieldOf({ name: 'at', kind: 'datetime' }) }
    const rules = { paths: [path], sortable: [], maxLimit: 100 } as never
    const sent: unknown[] = []
    // The panel's change is written to the URL and the list reads it back, which is where a moment with no zone gets one.
    const Linked = () => {
      const [where, setWhere] = useState(() => readQuery(new URLSearchParams('where[or][0][and][0][at][in][0]=2026-10-06T06:00:00.000Z'), rules).where)
      return createElement(Filters, {
        paths: [path], value: where, t, locale: 'en',
        onChange: (next: unknown) => {
          sent.push(next)
          setWhere(readQuery(new URLSearchParams(writeQuery({ where: next as never })), rules).where)
        },
      })
    }
    const host = await render(createElement(Linked))
    const box = () => host.querySelector<HTMLInputElement>('input[aria-label="value"]')!
    assert.equal(box().value, '2026-10-06T06:00:00.000Z', 'the link\'s instant is in the box')
    const typed = '2026-10-06T06:00:00.000Z, 2026-10-07T09:30'
    await act(async () => typeInto(box(), typed))
    await act(async () => sleep(400))
    assert.deepEqual(sent.at(-1), { or: [{ and: [{ at: { in: ['2026-10-06T06:00:00.000Z', '2026-10-07T06:30:00.000Z'] } }] }] }, '09:30 typed at UTC+3 is sent as 06:30Z')
    assert.equal(box().value, typed, 'and the box keeps the text typed, not the instant the link came back with')
    const more = `${typed}, 2026-10-08 10:00`
    await act(async () => typeInto(box(), more))
    await act(async () => sleep(400))
    assert.equal(box().value, more, 'typing on after the link came back loses nothing')
    assert.deepEqual(sent.at(-1), { or: [{ and: [{ at: { in: ['2026-10-06T06:00:00.000Z', '2026-10-07T06:30:00.000Z', '2026-10-08T07:00:00.000Z'] } }] }] }, 'and a moment written with a space is read the same way')
  } finally {
    process.env.TZ = homeZone
  }
})

test('180c. a test that sets the zone puts back the zone this process started in', () => {
  assert.equal(Intl.DateTimeFormat().resolvedOptions().timeZone, homeZone)
})

const Resettable = ({ initial, reported = [], locale = 'en', translate = t }: { initial: unknown; reported?: unknown[]; locale?: string; translate?: typeof t }) => {
  const [value, setValue] = useState<unknown>(initial)
  return createElement('div', null,
    createElement('button', { id: 'reset', onClick: () => setValue(undefined) }, 'reset'),
    createElement(controls.datetime!, {
      values: {}, setValue: () => {}, value, field: fieldOf({ name: 'at', kind: 'datetime' }), kayan: courses, id: 'at', t: translate, locale,
      readOnly: false, onChange: (next: unknown) => (reported.push(next), setValue(next)),
    }))
}

test('178h. a seeded moment clears with its time and returns when the time is typed again, and a reset from outside clears the day too', async () => {
  const reported: unknown[] = []
  const host = await render(createElement(Resettable, { initial: new Date(2026, 0, 2, 3, 4), reported }))
  const time = () => timeSegment(host, 'hours')
  const button = () => host.querySelector('button#at')!
  await typeTime(host, '')
  assert.deepEqual(reported, [null], 'clearing the time clears the value')
  assert.ok(button().textContent!.includes('January 2, 2026'), 'and the day stays')
  await typeTime(host, '03:04')
  assert.equal((reported as unknown as Date[])[1]!.getTime(), new Date(2026, 0, 2, 3, 4).getTime(), 'a time typed again returns the value on that day')
  await act(async () => click(host.querySelector('#reset') as unknown as Element))
  assert.equal(button().textContent, 'Pick a date', 'a value reset from outside leaves no day behind')
  assert.equal(time().disabled, true, 'and shuts the time box')
})

test('178i. a required moment with a day and no time is refused as required and sends nothing', async () => {
  const { client, written } = recording()
  const copy = copyFile(JSON.parse(readFileSync(new URL('../../../templates/asas/src/messages/sessions.json', import.meta.url), 'utf8'))) as Record<string, { en?: string }>
  const host = await render(createElement(Form, {
    kayan: sessions, screen: screenOf(recordPage([{ form: [{ field: 'startsAt' }, { field: 'capacity' }] }], '/sessions/new'), sessions), client, value: null,
    t: (key: string, fallback?: string) => (key.startsWith('sessions.') ? copy[key.slice('sessions.'.length)]?.en : undefined) ?? fallback, locale: 'en', onDone: () => {},
  }))
  await act(async () => typeInto(host.querySelector('#sessions-capacity')!, '5'))
  await act(async () => click(host.querySelector('button#sessions-startsAt') as unknown as Element))
  await act(async () => click(window.document.querySelector('[data-today] button') as unknown as Element))
  await act(async () => fire(host.querySelector('form')!, 'submit'))
  assert.equal(written.length, 0, 'a day alone sends nothing')
  assert.ok(host.querySelector('#sessions-startsAt-error'), 'and the moment is refused under its box')
  assert.equal(host.querySelector('#sessions-startsAt-error')?.textContent, 'This field is required.', 'as required')
  const time = timeSegment(host, 'hours')
  assert.deepEqual([time.getAttribute('aria-required'), time.getAttribute('aria-invalid')], ['true', 'true'], 'and the time box is marked required and refused')
})

test('178m. a session\'s start picked as a day and typed as a time saves as that instant, an edit saves the new time, and a required start cleared is refused as required', async () => {
  const page = (path: string) => screenOf(recordPage([{ form: [{ field: 'startsAt' }, { field: 'capacity' }] }], path), sessions)
  const created = recording()
  const host = await render(createElement(Form, { kayan: sessions, screen: page('/sessions/new'), client: created.client, value: null, t, locale: 'en', onDone: () => {} }))
  await act(async () => click(host.querySelector('button#sessions-startsAt') as unknown as Element))
  await act(async () => click(window.document.querySelector('[data-today] button') as unknown as Element))
  await typeTime(host, '12:30')
  await act(async () => fire(host.querySelector('form')!, 'submit'))
  assert.equal(host.querySelector('#sessions-startsAt-error'), null, 'the start is not refused')
  assert.equal(created.written.length, 1, 'the create is sent')
  assert.equal(new Date(created.written[0]!.startsAt as string).toISOString(), new Date(`${today}T12:30`).toISOString(), `as the local moment: ${JSON.stringify(created.written[0])}`)

  const edited = recording()
  const stored = new Date(2026, 9, 15, 12, 30).toISOString()
  const edit = await render(createElement(Form, { kayan: sessions, screen: page('/sessions/:id'), client: edited.client, value: { id: 's1', course: 'c1', capacity: 5, startsAt: stored }, t, locale: 'en', onDone: () => {} }))
  assert.equal(timeOf(edit), '12:30', 'the edit draws the stored time')
  await typeTime(edit, '14:45')
  await act(async () => fire(edit.querySelector('form')!, 'submit'))
  assert.equal(new Date(edited.written[0]!.startsAt as string).getTime(), new Date(2026, 9, 15, 14, 45).getTime(), `the edit saves the new time on the same day: ${JSON.stringify(edited.written[0])}`)

  await typeTime(edit, '')
  await act(async () => fire(edit.querySelector('form')!, 'submit'))
  assert.equal(edited.written.length, 1, 'a cleared required start sends nothing')
  assert.equal(edit.querySelector('#sessions-startsAt-error')?.textContent, 'sessions.startsAt.required', 'and is refused as required')
})

test('178j. a moment in a side region belongs to the page\'s form, so a submit from its time box saves the page', async () => {
  const saved: Record<string, unknown>[] = []
  const page = plus(recordPage([{ form: ['capacity'] }], '/sessions/:id'), 'side', { field: 'startsAt' })
  const host = await render(createElement(Form, {
    kayan: sessions, screen: screenOf(page, sessions),
    client: { create: async () => ({}), update: async (input: Record<string, unknown>) => (saved.push(input), {}), delete: async () => ({}) },
    value: { id: 's1', course: 'c1', capacity: 5, startsAt: new Date(2026, 0, 2, 3, 4).toISOString() }, t, locale: 'en', onDone: () => {},
  }))
  const pageForm = host.querySelector('[data-node="form"] form') as unknown as HTMLFormElement
  const time = timeSegment(host, 'hours')
  assert.ok(pageForm && time)
  assert.equal(pageForm.contains(time as unknown as Node), false, 'the time box is outside the form element')
  assert.ok(time.form === pageForm, 'and the form owns it all the same')
  assert.equal(time.hasAttribute('name'), false, 'though it posts nothing of its own')
  await typeTime(host, '10:30')
  // happy-dom makes no implicit submission on Enter, so the box's form owner is submitted as a browser would.
  await act(async () => time.form?.requestSubmit())
  assert.equal(saved.length, 1, 'a submit from it saves the page')
  assert.equal(new Date(saved[0]!.startsAt as string).getTime(), new Date(2026, 0, 2, 10, 30).getTime(), 'with the time typed')
})

test('178k. the calendar opens on the held day or today, and the button takes the focus back after a pick and after Escape', async () => {
  const host = await render(createElement(Resettable, { initial: new Date(2026, 0, 2, 3, 4) }))
  const button = () => host.querySelector('button#at') as unknown as HTMLElement
  const focused = (): unknown => window.document.activeElement
  await act(async () => click(button() as unknown as Element))
  await act(async () => sleep(50))
  assert.ok(focused() === window.document.querySelector('[data-day="2026-01-02"] button'), 'the held day has the focus once the calendar is open')
  await act(async () => press(focused() as Element, 'Escape'))
  await act(async () => sleep(50))
  assert.equal(window.document.querySelector('[data-slot="calendar"]'), null, 'Escape closes it')
  assert.ok(focused() === button(), 'and the button has the focus again')
  await act(async () => click(button() as unknown as Element))
  await act(async () => click(window.document.querySelector('[data-day="2026-01-05"] button') as unknown as Element))
  await act(async () => sleep(50))
  assert.ok(focused() === button(), 'a pick hands it back to the button too')
  await act(async () => click(host.querySelector('#reset') as unknown as Element))
  await act(async () => click(button() as unknown as Element))
  await act(async () => sleep(50))
  assert.ok(focused() === window.document.querySelector('[data-today] button'), 'over no held day it opens on today')
})

test('178l. the picker names its day and its time in the viewer\'s locale and draws one moment in any zone without a mismatch', async () => {
  const { renderToString } = await import('react-dom/server')
  const { hydrateRoot } = await import('react-dom/client')
  const arabic: typeof t = (key, fallback) => ({ 'admin.time': 'الوقت', 'courses.at': 'وقت البداية' })[key] ?? fallback
  const draw = (translate = t, locale = 'en') => createElement(Resettable, { initial: '2026-08-09T23:30:00.000Z', translate, locale })
  const ar = await render(draw(arabic, 'ar'))
  assert.equal(ar.querySelector('[data-time-field]')?.getAttribute('aria-label'), 'وقت البداية الوقت', 'the time box is named in Arabic, after its field')
  const names = (host: HTMLElement) => (host.querySelector('button#at')!.getAttribute('aria-labelledby') ?? '').split(' ').map((one) => host.querySelector(`[id="${one}"]`)?.textContent).join(' ')
  assert.ok(names(ar).startsWith('وقت البداية '), 'and the button is named by the field and its day')
  const zone = process.env.TZ
  const problems: unknown[] = []
  const logged = console.error
  try {
    process.env.TZ = 'UTC'
    const served = renderToString(draw())
    // 13:30 the next afternoon, which is the day after the server's.
    process.env.TZ = 'Pacific/Kiritimati'
    const host = mount()
    host.innerHTML = served
    console.error = (...told: unknown[]) => void problems.push(told)
    let root: ReturnType<typeof hydrateRoot> | undefined
    await act(async () => {
      root = hydrateRoot(host, draw(), { onRecoverableError: (error: unknown) => void problems.push(error) })
    })
    assert.equal(problems.length, 0, `no mismatch to report: ${problems.map(String).join(' | ')}`)
    assert.equal(host.querySelector('button#at')!.hasAttribute('aria-label'), false, 'no attribute carries the day')
    assert.equal(names(host), 'at August 10, 2026', 'and the button\'s name is the viewer\'s own day once it has mounted')
    assert.equal(timeOf(host), '13:30', 'and the time box shows the viewer\'s clock')
    await act(async () => root!.unmount())
  } finally {
    console.error = logged
    if (zone === undefined) delete process.env.TZ
    else process.env.TZ = zone
  }
})

test('27. a field cleared to empty is written as empty, and a field nothing touched is left out of the write', async () => {
  // An emptied box clears the stored value; an uncontrolled form would read it as "not given".
  const written: Record<string, unknown>[] = []
  const host = await render(
    createElement(Form, {
      kayan: courses,
      client: {
        create: async (input: Record<string, unknown>) => {
          written.push(input)
          return {}
        },
        update: async (input: Record<string, unknown>) => {
          written.push(input)
          return {}
        },
        delete: async () => ({}),
      },
      value: { id: 'a-row', title: 'Tajweed', summary: 'A short summary', fee: 300, archived: false },
      t,
      locale: 'en',
      onDone: () => {},
    }),
  )
  const summary = host.querySelector('#courses-summary')!
  await act(async () => {
    typeInto(summary, '')
  })
  await act(async () => {
    fire(host.querySelector('form')!, 'submit')
  })
  assert.equal(written.length, 1, 'the form ran one write')
  const sent = written[0]!
  assert.ok('summary' in sent, 'the cleared field is in the write rather than left out of it')
  assert.equal(sent.summary, null, 'and it is written as null, which is the wire\'s word for empty')
  assert.ok(!('title' in sent), 'a field nothing touched is left out of an update')
  assert.equal(sent.id, 'a-row', 'and the row being changed is named')
  for (const server of ['id', 'createdAt', 'updatedAt', 'organization']) {
    if (server === 'id') continue
    assert.ok(!(server in sent), `${server} is the server's and is not in the write`)
  }

  // A create carries its displayed defaults; a field with neither a default nor a value stays out.
  const madeHost = await render(
    createElement(Form, {
      kayan: courses,
      client: {
        create: async (input: Record<string, unknown>) => {
          written.push(input)
          return {}
        },
        update: async () => ({}),
        delete: async () => ({}),
      },
      value: null,
      t,
      locale: 'en',
      onDone: () => {},
    }),
  )
  await act(async () => {
    typeInto(madeHost.querySelector('#courses-title')!, 'New course')
  })
  await act(async () => {
    fire(madeHost.querySelector('form')!, 'submit')
  })
  const created = written[1]!
  assert.deepEqual(
    Object.keys(created).sort(),
    ['notifications', 'selfEnroll', 'title'],
    'a create carries the typed field and the defaults it drew; archived is never a create\'s',
  )
  assert.equal(created.title, 'New course')
  assert.equal('_status' in created, false, 'Publish leaves the status to the server')
  // A create still carries an untouched checkbox (drawn unchecked, which is a value) and a required list of text; an optional list stays out.
  assert.equal(created.notifications, false)
})

test('8. a field the page does not name is submitted by nothing, on an edit and on a create', async () => {
  // A screen's form sends only the fields its page names: others would write the loaded value back over another screen's change, or `false` over a checkbox nobody drew. A read-only leaf is left out too.
  const written: Record<string, unknown>[] = []
  const client = {
    create: async (input: Record<string, unknown>) => (written.push(input), {}),
    update: async (input: Record<string, unknown>) => (written.push(input), {}),
    delete: async () => ({}),
  }
  const page = (form: unknown[]): PageClient => recordPage([{ form }])
  const edit = await render(
    createElement(Form, {
      kayan: courses,
      screen: screenOf(page([{ field: 'title' }, { field: 'archived', readOnly: true }])),
      client,
      value: { id: 'a-row', title: 'Tajweed', summary: 'Kept', fee: 300, archived: true, notifications: true, level: 3 },
      t,
      locale: 'en',
      onDone: () => {},
    }),
  )
  await act(async () => typeInto(edit.querySelector('#courses-title')!, 'Tajweed II'))
  await act(async () => fire(edit.querySelector('form')!, 'submit'))
  assert.deepEqual(written[0], { id: 'a-row', title: 'Tajweed II' }, 'an edit writes the one field its page named and drew writable')

  const create = await render(
    createElement(Form, {
      kayan: courses,
      screen: screenOf(page([{ field: 'title' }])),
      client,
      value: null,
      t,
      locale: 'en',
      onDone: () => {},
    }),
  )
  await act(async () => typeInto(create.querySelector('#courses-title')!, 'New course'))
  await act(async () => fire(create.querySelector('form')!, 'submit'))
  assert.deepEqual(written[1], { title: 'New course' }, 'and a create writes no checkbox its page never drew')
})

test('28a. a picker whose field narrows its options reads for that field, so the server holds the page to them, and one whose field does not reads as before', async () => {
  for (const [filterOptions, expected] of [[true, 'sessions.course'], [undefined, undefined]] as const) {
    const { api, calls } = fakeApi({ courses: [{ id: 'c1', title: 'Tajweed' }] })
    const course = { ...sessions.fields.find((one) => one.name === 'course')!, ...(filterOptions && { filterOptions }) }
    const host = await render(createElement(RelationshipControl, { values: {}, setValue: () => {}, field: course, kayan: sessions, client: kayans, api, id: 'sessions-course', t, value: null, readOnly: false, onChange: () => {} }))
    await act(async () => {
      click(host.querySelector('#sessions-course') as unknown as Element)
    })
    assert.equal(calls.at(-1)?.input.for, expected, `a field ${filterOptions ? 'that narrows' : 'that does not'} reads ${expected ?? 'for nothing'}`)
  }
})

test('28. the picker loads page one on open with the limit, the sort and the not_in, and adds a like on the term 300 ms later', async () => {
  const { api, calls } = fakeApi({ courses: [{ id: 'c1', title: 'Tajweed' }] })
  const course = sessions.fields.find((one) => one.name === 'course')!
  const host = await render(
    createElement(RelationshipControl, {
        values: {}, setValue: () => {},
      field: course,
      kayan: sessions,
      client: kayans,
      api,
      id: 'sessions-course',
      t,
      value: 'already-chosen',
      readOnly: false,
      onChange: () => {},
    }),
  )
  const pages = () => calls.filter((call) => (call.input.where as { id?: { not_in?: unknown } }).id?.not_in !== undefined)
  await act(async () => {
    click(host.querySelector('#sessions-course') as unknown as Element)
  })
  assert.equal(pages().length, 1, 'opening the picker reads one page')
  assert.deepEqual(
    pages()[0],
    {
      target: 'courses',
      input: { limit: 10, page: 1, sort: 'title', where: { id: { not_in: ['already-chosen'] } } },
    },
    'page one, ten rows, sorted on the target\'s own title, with the selected row kept out',
  )

  // The term goes into the combobox input: the selection when the list is closed, the term when it is open.
  await act(async () => {
    typeInto(host.querySelector('#sessions-course') as unknown as Element, 'taj')
  })
  assert.equal(pages().length, 1, 'a keystroke alone reads nothing, because the term is debounced')
  await debounced()
  assert.equal(pages().length, 2, 'and the term settles into one more read')
  assert.deepEqual(
    pages()[1]!.input.where,
    { id: { not_in: ['already-chosen'] }, title: { like: 'taj' } },
    'which is the same constraint with a like on the title beside it',
  )
})

test('29. a target that declares no useAsTitle is searched and shown by its id, and takes no like', async () => {
  // A target that declares no `useAsTitle` falls to `id`; the template titles `sessions` by its start, so the step drops it.
  const { useAsTitle: _title, ...untitled } = sessions
  assert.equal(titleFieldOf(untitled), 'id', 'the fallback is the row\'s id')
  assert.equal(titleFieldOf(sessions), 'startsAt', 'the template titles a session by its start')
  assert.equal(titleFieldOf(courses), 'title', 'while a target that declares one is named by it')

  const { api, calls } = fakeApi({ sessions: [{ id: '5c1f0000-0000-4000-8000-000000000001', capacity: 12 }] })
  const session = enrollments.fields.find((one) => one.name === 'session')!
  const host = await render(
    createElement(RelationshipControl, {
        values: {}, setValue: () => {},
      field: session,
      kayan: enrollments,
      client: kayans.map((one) => (one.name === 'sessions' ? untitled : one)),
      api,
      id: 'enrollments-session',
      t,
      value: undefined,
      readOnly: false,
      onChange: () => {},
    }),
  )
  await act(async () => {
    click(host.querySelector('#enrollments-session') as unknown as Element)
  })
  assert.equal(calls[0]!.input.sort, 'id', 'the page is sorted on the id, since that is the title')
  assert.ok(opened()?.textContent?.includes('5c1f0000-0000-4000-8000-000000000001'), 'and a row is shown by its id')
  // An id is a uuid and `like` takes text and email alone, so the box takes no term rather than sending one the read would refuse with 400.
  assert.equal(
    (host.querySelector('#enrollments-session') as unknown as HTMLInputElement).readOnly,
    true,
    'the search box is read-only, because a term over this target could not be turned into a condition',
  )
})

test('218b. a session reads as its course and its start in the enrollment picker, held or listed, and by its start alone where the course is not read', async () => {
  const { SessionLabels } = await import('../../../templates/features/courses/enrollments/ui/session-labels.tsx')
  // The picker as the template imports it, by the package's name.
  const { RelationshipControl } = await import('mithaq-admin/relationship-control.tsx')
  const at = ['2026-10-12T09:00:00.000Z', '2026-10-12T13:00:00.000Z']
  const rows = [{ id: 's1', course: 'c1', startsAt: at[0] }, { id: 's2', course: 'c2', startsAt: at[1] }, { id: 's3', course: 'c9', startsAt: at[1] }]
  const { api } = fakeApi({ sessions: rows })
  const courseRows = [{ id: 'c1', title: 'Tajweed' }, { id: 'c2', title: 'Tafsir' }]
  // The courses are the viewer's own read; c9 is one it may not read.
  const client = async ({ kayan, input }: { kayan: string; input: Record<string, unknown> }) =>
    kayan === 'courses' ? pageOf(courseRows.filter((one) => (input.where as { id: { in: string[] } }).id.in.includes(one.id))) : pageOf([])
  const session = enrollments.fields.find((one) => one.name === 'session')!
  const queries = new QueryClient()
  const control = (value: unknown) => createElement(QueryClientProvider, { client: queries }, createElement(SessionLabels, null, createElement(RelationshipControl, {
    values: {}, setValue: () => {}, field: session, kayan: enrollments, client: kayans, api, id: 'enrollments-session', t, locale: 'en', value, readOnly: false, onChange: () => {},
  })))
  const held = await render(control('s1'), { client: client as never })
  await act(async () => sleep(30))
  assert.equal((held.querySelector('#enrollments-session') as unknown as HTMLInputElement).value.startsWith('Tajweed · '), true, `the held session names its course: ${(held.querySelector('#enrollments-session') as unknown as HTMLInputElement).value}`)
  const host = await render(control(undefined), { client: client as never })
  await act(async () => click(host.querySelector('#enrollments-session') as unknown as Element))
  await act(async () => sleep(30))
  const options = [...opened()!.querySelectorAll('[data-slot="combobox-item"]')].map((one) => one.textContent ?? '')
  assert.equal(options.length, 3, `every session is listed: ${options.join(' | ')}`)
  assert.equal(options[0]!.startsWith('Tajweed · ') && options[1]!.startsWith('Tafsir · '), true, `two sessions of one day are told apart by their courses: ${options.join(' | ')}`)
  assert.equal(options[2]!.includes(' · '), false, `and a session whose course is not read keeps its start: ${options[2]}`)
  queries.clear()
})

test('218c. an image lists by its thumbnail and its size in kilobytes or megabytes, its page leads with the image, Download and Replace file, and its New page opens the upload dialog', async (t) => {
  const { FileName, FileSize, MediaPreview, NewImage } = await import('../../../templates/features/media/media/ui/preview.tsx')
  const { sizeOf } = await import('../registry/upload.tsx')
  // The template's page imports the upload dialog by the package's name, and the dialog reads the map the same way.
  const { ComponentsProvider: AppComponents } = await import('mithaq-admin/components.tsx')
  const appDefaults = withAddOns((await import('mithaq-admin/default-components.tsx')).defaultComponents, (await import('mithaq-admin/rich-text.tsx')).richTextComponents, (await import('mithaq-admin/upload.tsx')).uploadComponents)
  const inApp = (element: ReactElement) => createElement(AppComponents, { components: appDefaults }, element)
  assert.deepEqual([sizeOf(512, 'en'), sizeOf(2048, 'en'), sizeOf(1536 * 1024, 'en')], ['512 bytes', '2 kilobytes', '1.5 megabytes'], 'bytes, kilobytes and megabytes as a person reads them')
  assert.deepEqual([sizeOf(512, 'ar'), sizeOf(1536 * 1024, 'ar')].map((one) => one.replace(/[\d٠-٩٫.]+\s*/, '')), ['بايت', 'ميغابايت'], 'and in Arabic, the megabyte long as the kilobyte is')
  const media = screen.kayan.media!
  const image = { id: 'm1', filename: 'cover.png', mimeType: 'image/png', filesize: 2048, alt: { en: 'A cover' }, url: '/api/media/file/m1', thumbnailURL: '/api/media/file/m1' }
  const size = await render(createElement(FileSize, { field: media.fields.find((one) => one.name === 'filesize')!, value: 2048, row: image }))
  assert.equal(size.textContent, '2 kilobytes', 'the size column is never the raw bytes')
  const name = await render(createElement(FileName, { field: media.fields.find((one) => one.name === 'filename')!, value: 'cover.png', row: image }))
  assert.equal(name.querySelector('img[data-upload-thumbnail]')?.getAttribute('src'), '/api/media/file/m1', 'the name column leads with the thumbnail')
  assert.equal(name.textContent, 'cover.png', 'and the name')
  assert.equal(name.querySelector('[title="cover.png"]')?.className.includes('min-w-28'), true, 'which keeps room enough to be read on a phone')

  const preview = (access: ScreenState['access']) => render(inApp(createElement(MediaPreview)), { kayan: media, record: image, access })
  let host = await preview({ collections: { media: { create: true } } } as never)
  assert.equal(host.querySelector('[data-media-download]')?.getAttribute('download'), 'cover.png', 'Download saves the file under its name')
  assert.equal(host.querySelector('[data-media-download]')?.getAttribute('href'), '/api/media/file/m1', 'through the file route')
  assert.equal(host.textContent?.includes('2 kilobytes'), true, 'the size reads in kilobytes')
  await act(async () => click(host.querySelector('[data-media-replace]')!))
  assert.equal(window.document.querySelector('[data-upload-dialog="media"]') !== null, true, 'Replace file opens the upload dialog')
  host = await preview({})
  assert.equal(host.querySelector('[data-media-replace]'), null, 'and is not offered to a viewer who may not make an image')

  const edit = media.pages.edit as Extract<PageClient, { page: unknown }>
  const side = ((edit.page.main as unknown as { side: unknown[] }[])[0]!.side as Record<string, unknown>[])
  assert.equal(String(side[0]!.component).endsWith('preview.tsx#MediaPreview'), true, 'the edit page draws the image beside the form')
  assert.equal(host.querySelector('[data-media-preview]')?.hasAttribute('data-lead'), true, 'marked to lead, so the record layout puts it above the form on a phone')
  assert.equal((media.pages.create as { component?: string }).component?.endsWith('preview.tsx#NewImage'), true, 'and the kayan has a New page, which the list\'s New button opens')

  const location = window.location as unknown as Record<'assign', (to: string) => void>
  const went: string[] = []
  t.mock.method(location, 'assign', (to: string) => void went.push(to))
  await render(inApp(createElement(NewImage, { page: media.pages.create! })), { kayan: media })
  assert.equal(window.document.querySelector('[data-upload-dialog="media"]') !== null, true, 'the New page opens the upload dialog at once')
  const cancel = [...window.document.querySelectorAll('[data-upload-dialog="media"] button')].find((one) => one.textContent === 'Cancel')
  await act(async () => click(cancel as unknown as Element))
  assert.deepEqual(went, ['/dashboard/media'], 'and closing it goes back to the list')
})

/** One element anywhere on the page, a portal's among them. */
const onPage = (selector: string) => window.document.querySelector(selector) as unknown as Element | null
/** The Members page as a viewer holding `permissions` draws it, its dialogs made openable under happy-dom. */
const membersPage = async ({ loaderData, permissions, collections = {}, over = {} }: { loaderData: Record<string, unknown>; permissions: string[] | '*'; collections?: Record<string, unknown>; over?: Partial<ScreenState> }) => {
  const { Members } = await import('../../../templates/asas/src/ui-dashboard/members.tsx')
  const host = await render(withToaster(createElement(Members, { loaderData } as never)), { t: english, access: { permissions, collections } as never, ...over })
  for (const one of host.querySelectorAll('dialog')) {
    ;(one as unknown as { showModal: () => void }).showModal = () => one.setAttribute('open', '')
    // A real dialog fires `close` however it is closed, which is what empties it.
    ;(one as unknown as { close: () => void }).close = () => (one.removeAttribute('open'), one.dispatchEvent(new window.Event('close') as unknown as Event))
  }
  const rows = (table = 0) => [...host.querySelectorAll('[data-members] table')[table]!.querySelectorAll('tbody tr')].map((one) => one.getAttribute('data-row'))
  const menu = async (id: string) => {
    await act(async () => click(host.querySelector(`[data-row-menu="${id}"]`)!))
    return [...window.document.querySelectorAll('[data-row-action]')].map((one) => one.getAttribute('data-row-action'))
  }
  const item = async (id: string, action: string) => {
    await menu(id)
    await act(async () => click(onPage(`[data-row-action="${action}"]`)!))
    await act(async () => sleep(10))
  }
  return { host, rows, menu, item }
}
const layla = { userId: 'u1', name: 'Layla', email: 'layla@example.com', joined: '2026-10-01T00:00:00.000Z', lastSeen: '2026-10-14T00:00:00.000Z', owner: false, roles: [{ id: 'a1', role: 'teacher' }] }
const omar = { userId: 'u2', name: 'Omar', email: 'omar@example.com', joined: '2026-10-02T00:00:00.000Z', owner: false, roles: [] }
const teacher = { name: 'teacher', label: { en: 'Teacher', ar: 'معلم' }, fixed: false, permissions: ['courses.find', 'courses.fields.title'] }
const administrator = { name: 'administrator', label: { en: 'Administrator', ar: 'مدير' }, fixed: true, permissions: ['*'] }
const pendingInvite = { id: 'i1', email: 'old@example.com', role: 'member', inviter: 'Layla', expiresAt: '2099-10-14T00:00:00.000Z', expired: false }
const lapsedInvite = { id: 'i2', email: 'late@example.com', role: 'member', expiresAt: '2000-10-14T00:00:00.000Z', expired: true }

test('218d. the members page is the list table: Members · N, a person with their address, roles, joined and last seen, searched and filtered by role, and last seen only to a viewer holding its key', async () => {
  const loaderData = { members: [layla, omar], roles: [administrator, teacher] }
  const { host, rows } = await membersPage({ loaderData, permissions: ['member.find', 'memberRoles.find', 'member.fields.lastSeenAt'] })
  assert.equal(host.querySelector('h1')?.textContent, 'Members · 2', 'the heading counts the members')
  assert.ok(host.querySelector('[data-members] [data-slot="card"] table'), 'drawn on the list table, inside the list\'s card')
  assert.deepEqual([...host.querySelectorAll('[data-members] thead th')].map((one) => one.textContent), ['Name', 'Roles', 'Joined', 'Last seen', 'Actions'])
  const first = host.querySelector('tbody tr[data-row="u1"]')!
  assert.equal(first.querySelector('td')!.textContent, 'Laylalayla@example.com', 'the first column is the name with the address under it')
  assert.ok(first.textContent!.includes('Teacher'), 'a role by its label')
  assert.ok(host.querySelector('tbody tr[data-row="u2"]')!.textContent!.includes('—'), 'never seen is a dash')
  const search = host.querySelector('input[type="search"]')!
  assert.equal(search.getAttribute('aria-label'), 'Search', 'the search box is named')
  await act(async () => typeInto(search, 'omar@'))
  await debounced()
  assert.deepEqual(rows(), ['u2'], 'the search runs over the name and the address')
  await act(async () => typeInto(search, ''))
  await debounced()
  const filter = host.querySelector('[data-role-filter]') as unknown as HTMLSelectElement
  assert.equal(host.querySelector(`label[for="${filter.id}"]`)?.textContent, 'Role', 'the role filter is named')
  filter.value = 'teacher'
  await act(async () => void fire(filter as unknown as Element, 'change'))
  assert.deepEqual(rows(), ['u1'], 'and the role filter keeps the members holding the role')
  filter.value = 'administrator'
  await act(async () => void fire(filter as unknown as Element, 'change'))
  assert.equal(host.querySelector('[data-list-message]')?.textContent?.includes('No rows match this filter.'), true, 'a filter matching nobody says so, with a way to clear it')

  const hidden = await membersPage({ loaderData, permissions: ['member.find', 'memberRoles.find'] })
  assert.ok(![...hidden.host.querySelectorAll('thead th')].some((one) => one.textContent === 'Last seen'), 'without member.fields.lastSeenAt there is no Last seen column')
  assert.equal(hidden.host.querySelector('[data-members-tab]'), null, 'and to a viewer who may not invite, no Invitations tab')
  assert.equal(hidden.host.querySelector('[data-invite]'), null, 'nor Invite')
  assert.equal(hidden.host.querySelector('[data-row-menu]'), null, 'and a viewer who may change nothing gets no row menu')
})

test('229c. invitations: a tab counting them, Email, Role, Sent by and Expires, one run out greyed, and a row menu that copies, sends again and cancels, each said in a green toast; the invite dialog refuses an empty or malformed address and empties on close', async (t) => {
  await toasted()
  let answer: [number, unknown] = [400, { code: 'USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION', message: 'User is already a member of this organization' }]
  const sent: { path: string; body: Record<string, unknown> }[] = []
  t.mock.method(globalThis, 'fetch', async (url: unknown, init: { body: string }) => {
    sent.push({ path: String(url), body: JSON.parse(init.body) as Record<string, unknown> })
    return Response.json(answer[1], { status: answer[0] })
  })
  const copied: string[] = []
  Object.defineProperty(globalThis.navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => void copied.push(text) } })
  const { host, rows, menu, item } = await membersPage({ loaderData: { members: [layla], roles: [teacher], invites: [pendingInvite, lapsedInvite] }, permissions: ['member.find', 'invitation.create', 'invitation.cancel'] })
  assert.deepEqual([...host.querySelectorAll('[data-members-tab]')].map((one) => one.textContent), ['Members', 'Invitations (2)'])
  assert.deepEqual([...host.querySelectorAll('[data-members] table')[1]!.querySelectorAll('thead th')].map((one) => one.textContent), ['Email', 'Role', 'Sent by', 'Expires', 'Actions'])
  assert.deepEqual(rows(1), ['i1', 'i2'])
  const lapsed = host.querySelector('tr[data-row="i2"]')!
  assert.ok(lapsed.querySelector('[data-expired]')?.textContent?.startsWith('Expired'), 'one run out says so')
  assert.ok([...lapsed.querySelectorAll('td')].slice(0, 4).every((one) => (one.querySelector('[data-list-value]') ?? one).firstElementChild?.className.includes('text-muted-foreground')), 'and is greyed')
  assert.deepEqual([...host.querySelectorAll('tr[data-row="i1"] [data-list-value]')].slice(0, 2).map((one) => one.textContent), ['Member', 'Layla'], 'the role by its word and who sent it')
  assert.equal(host.querySelector('[data-row-menu="i1"]')?.getAttribute('aria-label'), 'Actions for ⁨old@example.com⁩', 'each menu names its invitation')
  assert.deepEqual(await menu('i2'), ['resend', 'cancel'], 'a link run out is sent again, never copied')
  await act(async () => press(window.document.activeElement as unknown as Element, 'Escape'))

  answer = [200, { id: 'i1', email: 'old@example.com', role: 'member', expiresAt: '2099-11-01T00:00:00.000Z' }]
  await item('i1', 'copy-link')
  assert.deepEqual(copied, ['http://localhost/auth/accept-invitation?id=i1'], 'Copy link copies the link the invitee opens')
  await item('i1', 'resend')
  assert.deepEqual(sent.at(-1), { path: '/api/auth/user/organization/invite-member', body: { email: 'old@example.com', role: 'member', resend: true } }, 'Resend asks the provider to send it again')
  assert.deepEqual(await toasted(), ['success: Link copied', 'success: Invitation sent again to old@example.com'], 'each said in green')
  answer = [200, { id: 'i9', email: 'late@example.com', role: 'member', expiresAt: '2099-11-01T00:00:00.000Z' }]
  await item('i2', 'resend')
  assert.deepEqual(rows(1), ['i1', 'i9'], 'one run out and sent again as a new invitation is listed once, live')
  answer = [200, {}]
  await item('i9', 'cancel')
  assert.deepEqual(sent.at(-1), { path: '/api/auth/user/organization/cancel-invitation', body: { invitationId: 'i9' } }, 'Cancel withdraws it')
  assert.deepEqual(rows(1), ['i1'], 'and it leaves the list')
  assert.deepEqual(await toasted(), ['success: Invitation sent again to late@example.com', 'success: Invitation cancelled'])

  sent.length = 0
  answer = [400, { code: 'USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION' }]
  const invite = host.querySelector('[data-invite-sheet]')!
  const box = () => invite.querySelector('input[name="email"]')!
  await act(async () => click(host.querySelector('[data-invite]')!))
  assert.equal(invite.hasAttribute('open'), true, 'Invite opens its dialog')
  await act(async () => fire(invite.querySelector('form')!, 'submit'))
  assert.equal(invite.querySelector(`#${box().id}-error`)?.textContent, 'This field is required.', 'an empty address is refused under the box')
  await act(async () => typeInto(box(), 'not-an-email'))
  await act(async () => fire(invite.querySelector('form')!, 'submit'))
  assert.equal(invite.querySelector(`#${box().id}-error`)?.textContent, 'Invalid email', 'and one that is no address')
  assert.deepEqual(sent, [], 'neither is sent')
  await act(async () => typeInto(box(), 'layla@example.com'))
  await act(async () => fire(invite.querySelector('form')!, 'submit'))
  await act(async () => sleep(10))
  assert.equal(invite.querySelector('[role="alert"]')?.textContent, 'This person is already a member of this organization.', 'the provider\'s refusal is worded by its code')
  await act(async () => click([...invite.querySelectorAll('button')].find((one) => one.textContent === 'Cancel')!))
  await act(async () => click(host.querySelector('[data-invite]')!))
  assert.deepEqual([(box() as HTMLInputElement).value, invite.querySelector('[role="alert"]')], ['', null], 'and the dialog is empty when opened again')
  answer = [200, { id: 'i3', email: 'new@example.com', role: 'member', expiresAt: '2099-10-20T00:00:00.000Z' }]
  await act(async () => typeInto(box(), ' new@example.com '))
  await act(async () => fire(invite.querySelector('form')!, 'submit'))
  await act(async () => sleep(10))
  assert.deepEqual(sent.at(-1), { path: '/api/auth/user/organization/invite-member', body: { email: 'new@example.com', role: 'member' } }, 'an invitation goes through the provider\'s own route, as a member')
  assert.deepEqual([rows(1), invite.hasAttribute('open')], [['i1', 'i3'], false], 'joins the list, and the dialog closes')
  assert.deepEqual(await toasted(), ['success: Invitation sent to new@example.com'])
})

test('216c. the member page keeps grant limits, the owner role and assignment writes', async () => {
  await toasted()
  const { MemberPage } = await import('../registry/members.tsx')
  const { membersOptions } = await import('../../../templates/asas/src/ui-dashboard/members.tsx')
  const written: string[] = []
  const client: ScreenState['client'] = async ({ kayan, operation, input }) => (written.push(`${kayan}.${operation} ${String(input.id ?? input.role)}`), { id: 'r9' })
  const access = { permissions: ['member.find', 'roles.find', 'memberRoles.find', 'memberRoles.create', 'memberRoles.delete', 'courses.find', 'courses.fields.title'], collections: { memberRoles: { create: true, delete: true } } } as never
  const host = await render(withToaster(createElement(MemberPage, { member: layla, roles: [administrator, teacher], options: membersOptions })), { t: english, access, client })
  const role = (name: string) => host.querySelector(`[data-role="${name}"]`)!
  assert.ok(role('teacher').querySelector('[data-group="courses"]'))
  assert.equal(role('teacher').querySelector('[data-role-summary]')?.hasAttribute('open'), true)
  assert.equal(role('administrator').querySelector('[data-role-summary]')?.hasAttribute('open'), false)
  assert.equal(role('administrator').getAttribute('data-disabled'), 'true')
  assert.ok(role('administrator').querySelector('[data-locked]'))
  const save = () => [...host.querySelectorAll('button')].find((one) => one.textContent === 'Save')!
  assert.equal(save().hasAttribute('disabled'), true)
  await act(async () => click(role('teacher').querySelector('.font-medium')!))
  assert.equal(save().hasAttribute('disabled'), false)
  await act(async () => click(save()))
  assert.deepEqual(written, ['memberRoles.delete a1'])
  assert.ok(host.querySelector('[data-member-page]'), 'saving keeps the member page open')
  assert.equal(save().hasAttribute('disabled'), true, 'the saved roles are now the baseline')
  assert.deepEqual(await toasted(), ['success: Roles saved for Layla'])
  const owned = await render(createElement(MemberPage, { member: { ...omar, owner: true }, roles: [administrator, teacher], options: membersOptions }), { t: english, access, client })
  const admin = owned.querySelector('[data-role="administrator"]')!
  const dimmed = (element: Element | null) => (element?.className ?? '').split(' ').some((one) => one.includes('opacity-50'))
  assert.ok(admin.querySelector('[data-owner]'))
  assert.deepEqual([dimmed(admin), dimmed(admin.querySelector('[data-owner]')), dimmed(admin.querySelector('.font-medium'))], [false, false, true])
})

test('229g. Remove is offered only where the viewer may take every role the member holds, asks in a dialog, and takes each role through the assignment kayan before the membership; one refused part way keeps the member', async (t) => {
  await toasted()
  const sent: string[] = []
  t.mock.method(globalThis, 'fetch', async (url: unknown) => (sent.push(String(url)), Response.json({})))
  const boss = { userId: 'u3', name: 'Boss', email: 'boss@example.com', joined: '2026-10-01', owner: false, roles: [{ id: 'a3', role: 'administrator' }] }
  const aide = { name: 'aide', fixed: false, permissions: ['courses.find'] }
  const both = { userId: 'u4', name: 'Both', email: 'both@example.com', joined: '2026-10-01', owner: false, roles: [{ id: 'b1', role: 'teacher' }, { id: 'b2', role: 'aide' }] }
  const client: ScreenState['client'] = async ({ kayan, operation, input }) => {
    if (input.id === 'b2') throw Object.assign(new Error('refused'), { data: { key: 'error.forbidden.assign' } })
    sent.push(`${kayan}.${operation} ${String(input.id)}`)
    return {}
  }
  const { host, item, rows } = await membersPage({
    loaderData: { members: [layla, boss, both], roles: [administrator, teacher, aide] },
    permissions: ['member.find', 'memberRoles.find', 'memberRoles.delete', 'member.delete', 'courses.find', 'courses.fields.title'],
    collections: { memberRoles: { delete: true } },
    over: { client },
  })
  assert.equal(host.querySelector('[data-row-menu="u3"]'), null, 'no actions for an administrator whose every key the viewer does not hold')
  await item('u1', 'remove')
  assert.deepEqual(sent, [], 'Remove only asks')
  assert.ok(onPage('[data-remove-member]')?.textContent?.includes('Remove Layla?'), 'naming the member')
  await act(async () => click(onPage('[data-button="confirm-remove"]')!))
  await act(async () => sleep(10))
  assert.deepEqual(sent, ['memberRoles.delete a1', '/api/auth/user/organization/remove-member'], 'the role is taken through its kayan, then the membership')
  assert.ok(!rows().includes('u1'), 'and the member leaves the table')
  await item('u4', 'remove')
  await act(async () => click(onPage('[data-button="confirm-remove"]')!))
  await act(async () => sleep(10))
  assert.ok(rows().includes('u4'), 'a removal refused part way keeps the member')
  assert.ok(!host.querySelector('tr[data-row="u4"]')!.textContent!.includes('Teacher'), 'holding only what was not taken')
  assert.deepEqual(await toasted(), ['success: Layla removed', `error: ${english('error.forbidden.assign')}`], 'each said in a toast')
})

test('240c. Add person says in a green toast who was added and where the link went, and reads the page again in place rather than reloading it', async (t) => {
  await toasted()
  const { AddPerson } = await import('../../../templates/asas/src/ui-dashboard/members.tsx')
  t.mock.method(globalThis, 'fetch', async () => Response.json({ added: true }))
  const reload = window.location.reload
  let reloaded = 0
  let refreshed = 0
  const refresh = () => void refreshed++
  window.addEventListener('mithaq:refresh', refresh)
  Object.defineProperty(window.location, 'reload', { configurable: true, value: () => void reloaded++ })
  try {
    const sheet = { current: null as HTMLDialogElement | null }
    const adding = await render(withToaster(createElement(AddPerson, { sheet, roles: [], onInvited: () => {} })), { t: english })
    const add = adding.querySelector('[data-add-person-sheet]') as unknown as HTMLDialogElement
    ;(add as unknown as { showModal: () => void }).showModal = () => add.setAttribute('open', '')
    ;(add as unknown as { close: () => void }).close = () => (add.removeAttribute('open'), add.dispatchEvent(new window.Event('close') as unknown as Event))
    sheet.current!.showModal()
    const [name, email] = [...add.querySelectorAll('input')] as unknown as Element[]
    await act(async () => typeInto(name!, 'Omar'))
    await act(async () => typeInto(email!, 'omar@example.com'))
    await act(async () => fire(add.querySelector('form')!, 'submit'))
    await act(async () => sleep(10))
    assert.deepEqual(await toasted(), ['success: Omar added. A link to choose a password was sent to omar@example.com.'], 'a person added, and where the link went')
    assert.deepEqual([reloaded, refreshed, add.hasAttribute('open')], [0, 1, false], 'the page is read again in place, so the toast stays, and the sheet closes')
  } finally {
    window.removeEventListener('mithaq:refresh', refresh)
    Object.defineProperty(window.location, 'reload', { configurable: true, value: reload })
  }
})

test('240j. the dashboard\'s Members card counts the members and, to a reader of the assignments, how many hold each role, an owner holding administrator, and links the page; a viewer who may not list members is drawn none', async () => {
  const { membersFigures, MembersCard } = await import('../../../templates/asas/src/ui-dashboard/members-card.tsx')
  const listed = [
    { userId: 'u1', role: 'owner', createdAt: '2026-01-01T00:00:00.000Z', user: { name: 'Sana', email: 'sana@example.com' } },
    { userId: 'u2', role: 'member', createdAt: '2026-01-02T00:00:00.000Z', user: { name: 'Omar', email: 'omar@example.com' } },
    { userId: 'u3', role: 'member', createdAt: '2026-01-03T00:00:00.000Z', user: { name: 'Huda', email: 'huda@example.com' } },
  ]
  const asked: string[] = []
  const tools = (permissions: string[]) => ({
    access: { permissions } as never,
    maxLimit: 100,
    request: async (path: string) => (asked.push(path), Response.json({ members: listed, total: listed.length })),
    client: (async ({ kayan }: { kayan: string }) => (kayan === 'memberRoles' ? { docs: [{ id: 'a', user: 'u2', role: 'student' }, { id: 'b', user: 'u3', role: 'student' }], totalDocs: 2 } : { docs: [] })) as never,
  })
  assert.equal(await membersFigures(tools(['memberRoles.find'])), undefined, 'nothing to a viewer without member.find')
  assert.deepEqual(asked, [], 'and nobody is asked')
  assert.deepEqual(await membersFigures(tools(['member.find'])), { total: 3 }, 'the total alone to one who may not read the assignments')
  const figures = (await membersFigures(tools(['member.find', 'memberRoles.find'])))!
  assert.deepEqual(figures.held?.map((one) => [one.role, one.count]), [['administrator', 1], ['student', 2]], 'each role by how many hold it, the owner holding administrator')
  const card = await render(createElement(MembersCard, { figures, href: '/dashboard/members' }), { t: english })
  assert.equal(card.querySelector('[data-kpi="members"] [data-members-held]')?.textContent, '1 Administrator · 2 Student')
  assert.equal(card.querySelector('[data-kpi="members"] a')?.getAttribute('href'), '/dashboard/members', 'and links the page')
  const arabic = await render(createElement(MembersCard, { figures, href: '/dashboard/members' }), { t: appCopy('ar'), locale: 'ar', dir: 'rtl' })
  assert.equal(arabic.querySelector('[data-members-held]')?.textContent, `${new Intl.NumberFormat('ar').format(1)} مدير · ${new Intl.NumberFormat('ar').format(2)} طالب`, 'in Arabic, in its own digits')
})

test('240z. the members page reads in Arabic: its heading, tabs, columns, filter and menus', async () => {
  const { host } = await membersPage({
    loaderData: { members: [layla], roles: [teacher], invites: [pendingInvite] },
    permissions: ['member.find', 'memberRoles.find', 'invitation.create', 'invitation.cancel'],
    collections: { memberRoles: { create: true } },
    over: { t: appCopy('ar'), locale: 'ar', dir: 'rtl' },
  })
  assert.equal(host.querySelector('h1')?.textContent, `الأعضاء · ${new Intl.NumberFormat('ar').format(1)}`)
  assert.deepEqual([...host.querySelectorAll('[data-members-tab]')].map((one) => one.textContent), ['الأعضاء', `الدعوات (${new Intl.NumberFormat('ar').format(1)})`])
  assert.deepEqual([...host.querySelectorAll('[data-members] table')[0]!.querySelectorAll('thead th')].map((one) => one.textContent), ['الاسم', 'الأدوار', 'تاريخ الانضمام', 'الإجراءات'])
  assert.equal(host.querySelector('[data-role-filter] option')?.textContent, 'كل الأدوار')
  assert.ok(!host.querySelector('[data-row-menu="u1"]'), 'the row link already opens roles')
})

test('229d. a role\'s delete names a holder it may not read as a member, never by id', async () => {
  const client: ScreenState['client'] = async ({ kayan }) => (kayan === 'memberRoles' ? { docs: [{ user: 'u-unread' }] } : Promise.reject(new Error('forbidden')))
  const deleting = await render(createElement(DeleteRole, { run: async () => {}, busy: false } as never), { record: { id: 'r1', name: 'teacher' }, client })
  await act(async () => click(deleting.querySelector('[data-button="delete"]') as Element))
  const holders = [...window.document.querySelectorAll('[data-holders] a')]
  assert.deepEqual(holders.map((one) => one.textContent), ['A member'], 'a holder the viewer may not read is a member')
  assert.equal(holders[0]?.getAttribute('href')?.endsWith('/members/u-unread'), true, 'and the link still opens their roles')
})

test('229h. a fixed role opens a read-only page with its permission summary', async () => {
  const { FixedRole, loader } = await import('../../../templates/asas/src/ui-dashboard/fixed-role.tsx')
  const data = await loader({ params: { name: 'instructor' } } as never)
  const host = await render(createElement(FixedRole, { loaderData: data }), { t: english })
  const summary = host.querySelector('[data-fixed-role]')!
  assert.ok(summary.querySelector('[data-key="courses.find"]'))
  assert.equal(summary.querySelector('form'), null)
  assert.equal(summary.querySelector('[data-button]'), null)
  assert.equal((await loader({ params: { name: '__proto__' } } as never)).role, undefined)
})

test('229f. a role\'s form refused on save marks its name and both labels required and refused, each with its sentence under it, and its permissions group refused where the server names it', async () => {
  // The form by the package's name, as the role form binds its fields through it.
  const { Form: AppForm } = await import('mithaq-admin/form.tsx')
  const { RoleForm } = await import('../../../templates/features/roles/roles/ui/role-form.tsx')
  const roles = screen.kayan.roles!
  const sent: Record<string, unknown>[] = []
  // The server refuses the permissions, as it would a key the role may not hold.
  const client = {
    create: async (input: Record<string, unknown>) => {
      sent.push(input)
      throw { data: { key: 'refused', params: { issues: [{ path: 'permissions', message: 'roles.permissions.invalid' }] } } }
    },
    update: async () => ({}),
    delete: async () => ({}),
  }
  const page = roles.pages.create as Extract<PageClient, { page: unknown }>
  const host = await render(
    createElement(AppForm, { kayan: roles, screen: screenOf(page, roles, { '@asas/roles:./roles/ui/role-form.tsx#RoleForm': RoleForm }), client, value: null, t, locale: 'en', onDone: () => {} }),
    { kayan: roles, access: { permissions: '*' } as never },
  )
  const ids = ['roles-name', 'roles-label-en', 'roles-label-ar']
  const marks = () => ids.map((id) => [host.querySelector(`#${id}`)?.getAttribute('aria-required'), host.querySelector(`#${id}`)?.getAttribute('aria-invalid') ?? null, host.querySelector(`#${id}-error`)?.textContent ?? null])
  const group = () => host.querySelector('[role="group"][aria-label="Permissions, required"]')
  const groups = [...host.querySelectorAll('[data-group] > [data-slot="collapsible-trigger"], [data-group] > h3 > [data-slot="collapsible-trigger"]')]
  assert.ok(groups.length > 0 && groups.every((one) => one.getAttribute('aria-expanded') === 'true'), 'the editor starts with every group of keys open')
  assert.deepEqual(marks(), ids.map(() => ['true', null, null]), 'every box says it is required before anything is typed, and nothing is refused')
  assert.equal(group()?.hasAttribute('aria-required'), false, 'the permissions group says it is required in its name, since a group takes no aria-required')
  await act(async () => fire(host.querySelector('form')!, 'submit'))
  assert.equal(sent.length, 0, 'an empty role is not sent')
  assert.deepEqual(marks().map(([required, invalid]) => [required, invalid]), ids.map(() => ['true', 'true']), 'each box marks itself refused')
  assert.equal(marks().every(([, , said]) => typeof said === 'string' && said.length > 0), true, `with a sentence under each: ${JSON.stringify(marks())}`)

  for (const [id, value] of [['roles-name', 'teacher'], ['roles-label-en', 'Teacher'], ['roles-label-ar', 'معلم']] as const) await act(async () => typeInto(host.querySelector(`#${id}`)!, value))
  await act(async () => fire(host.querySelector('form')!, 'submit'))
  await act(async () => sleep(10))
  assert.equal(sent.length, 1, 'a role with its names is sent')
  assert.deepEqual([group()?.getAttribute('aria-invalid'), group()?.getAttribute('aria-describedby')], ['true', 'roles-permissions-error'], 'and the permissions the server refused mark themselves and point at why')
  assert.equal(host.querySelector('#roles-permissions-error')?.textContent, 'roles.permissions.invalid', 'which is said under them')
})

test('30. a selected row that is not on the page is named by one read, and one chosen from the page by none', async () => {
  const { api, calls } = fakeApi({ courses: [{ id: 'c1', title: 'Tajweed' }, { id: 'c2', title: 'Tafsir' }] })
  const course = sessions.fields.find((one) => one.name === 'course')!
  const props = (value: unknown, onChange: (next: unknown) => void) => ({
    field: course,
    values: {}, setValue: () => {},
    kayan: sessions,
    client: kayans,
    api,
    id: 'sessions-course',
    t,
    value,
    readOnly: false,
    onChange,
  })

  // Absent: the id is held but the page never carries it (`not_in` keeps it off), so it is read once by `id in`.
  const held = await render(createElement(RelationshipControl, props('c9', () => {})))
  const hydrations = calls.filter((call) => (call.input.where as { id?: { in?: unknown } }).id?.in !== undefined)
  assert.equal(hydrations.length, 1, 'the selected row is read once')
  assert.deepEqual(hydrations[0]!.input, { where: { id: { in: ['c9'] } }, limit: 1 }, 'by its id alone, one row')
  assert.equal(calls.length, 1, 'and nothing else is read, because the list has not been opened')
  assert.ok(held, 'the control mounted')

  // Present: the row is chosen off the loaded page, so the picker already holds it and reads nothing more.
  calls.length = 0
  const chosen: unknown[] = []
  const host = await render(createElement(RelationshipControl, props(undefined, (next) => chosen.push(next))))
  await act(async () => {
    click(host.querySelector('#sessions-course') as unknown as Element)
  })
  const option = opened()!.querySelectorAll('[data-slot="combobox-item"]')[0]!
  await act(async () => {
    click(option as unknown as Element)
  })
  assert.deepEqual(chosen, ['c1'], 'the picker reports the id of the row that was chosen')
  assert.equal(
    calls.filter((call) => (call.input.where as { id?: { in?: unknown } }).id?.in !== undefined).length,
    0,
    'and reads nothing to name it, because the row it was chosen from is what names it',
  )
})

test('31. a page of rows is one read per target and never one per row, and the names replace the ids', async () => {
  const { api, calls } = fakeApi({
    sessions: [{ id: 's1' }, { id: 's2' }],
    user: [{ id: 'u1', name: 'Hana' }],
  })
  // Three rows over two sessions and one student are six relationship cells: one read per target is two reads, one per cell would be six.
  const docs = [
    { id: 'e1', session: 's1', student: 'u1' },
    { id: 'e2', session: 's2', student: 'u1' },
    { id: 'e3', session: 's1', student: 'u1' },
  ]
  // The student's target as a listing would print it, titled by `name`. The dashboard draws no `user`, so the kayan is written here.
  const user: ClientKayan = {
    name: 'user',
    single: false,
    fields: [fieldOf({ name: 'id', kind: 'text' }), fieldOf({ name: 'name', kind: 'text' })],
    operations: [],
    useAsTitle: 'name',
    pages: {},
  }
  const host = await render(
    createElement(List, {
      kayan: enrollments,
      client: [...kayans, user],
      api,
      page: { docs, hasNextPage: false, hasPrevPage: false, limit: 10, nextPage: null, page: 1, prevPage: null, totalDocs: 3, totalPages: 1 },
      query: {},
      t,
      locale: 'en',
      onQuery: () => {},
      href: (id: string) => `/enrollments/${id}`,
      newHref: '/enrollments/new',
    }),
  )
  assert.equal(calls.length, 2, `two targets on the page is two reads, not six: ${JSON.stringify(calls.map((one) => one.target))}`)
  const bySession = calls.find((one) => one.target === 'sessions')!
  assert.deepEqual(bySession.input, { where: { id: { in: ['s1', 's2'] } }, limit: 2 }, 'each id once, and the limit is the count asked for')
  const byUser = calls.find((one) => one.target === 'user')!
  assert.deepEqual(byUser.input, { where: { id: { in: ['u1'] } }, limit: 1 }, 'and the student appearing three times is read once')
  assert.ok(host.textContent?.includes('Hana'), 'and the answer reached the cells')
  assert.ok(!host.textContent?.includes('u1'), 'in place of the id')
})

test('184b. a table wider than its frame fades at the end it scrolls toward, and the fade goes once the last column is in view', async () => {
  const docs = [{ id: 'e1', session: 's1', student: 'u1' }]
  const host = await render(
    createElement(List, {
      kayan: enrollments,
      page: { docs, hasNextPage: false, hasPrevPage: false, limit: 10, nextPage: null, page: 1, prevPage: null, totalDocs: 1, totalPages: 1 },
      query: {},
      t,
      locale: 'en',
      onQuery: () => {},
      href: (id: string) => `/enrollments/${id}`,
      newHref: '/enrollments/new',
    }),
  )
  const frame = host.querySelector('table')!.parentElement!
  const cue = () => host.querySelector('[data-scroll-cue]') !== null
  assert.equal(cue(), false, 'a table that fits draws no cue')
  // happy-dom lays nothing out, so the frame is given the widths a phone gives it.
  Object.defineProperties(frame, { scrollWidth: { value: 900, configurable: true }, clientWidth: { value: 340, configurable: true } })
  await act(async () => fire(frame, 'scroll'))
  assert.equal(cue(), true, 'a table wider than its frame draws the cue')
  // Scrolled to its end, which a right-to-left page reports as a negative offset.
  Object.defineProperty(frame, 'scrollLeft', { value: -560, configurable: true })
  await act(async () => fire(frame, 'scroll'))
  assert.equal(cue(), false, 'and drops it once the last column is in view, whichever way the page reads')
})

test('32. a row the read did not answer for says the viewer cannot see it, never its raw id, which reads differently from a row still being read', async () => {
  const docs = [{ id: 'e1', session: 's1', student: 'u1' }]
  const listWith = (api: FindApi) =>
    createElement(List, {
      kayan: enrollments,
      client: kayans,
      api,
      page: { docs, hasNextPage: false, hasPrevPage: false, limit: 10, nextPage: null, page: 1, prevPage: null, totalDocs: 1, totalPages: 1 },
      query: {},
      t,
      locale: 'en',
      onQuery: () => {},
      href: (id: string) => `/enrollments/${id}`,
      newHref: '/enrollments/new',
    })

  const waiting = await render(listWith(fakeApi({ sessions: [], user: [] }, { silent: true }).api))
  assert.ok(waiting.textContent?.includes('Loading…'), `a cell whose read has not answered says so:\n${waiting.textContent?.slice(0, 200)}`)

  // Answered without the row: the viewer reads the kayan and the row is gone, never loading nor the raw id the column holds.
  const missing = await render(listWith(fakeApi({ sessions: [], user: [] }).api))
  assert.ok(!missing.textContent?.includes('Loading…'), 'a settled read leaves nothing loading')
  assert.ok(missing.textContent?.includes('Deleted'), `and the row the read did not answer for reads as deleted:\n${missing.textContent?.slice(0, 300)}`)
  assert.ok(!missing.textContent?.includes('u1') && !missing.textContent?.includes('s1'), 'never an id the column holds')

  // Refused outright: the 403 a role with the key and no field of the target meets.
  const refused = await render(listWith({ sessions: { find: async () => { throw Object.assign(new Error('Forbidden.'), { status: 403 }) } }, user: { find: async () => { throw Object.assign(new Error('Forbidden.'), { status: 403 }) } } }))
  await act(async () => sleep(0))
  assert.ok(refused.textContent?.split('Not available').length === 3 && !refused.textContent?.includes('u1') && !refused.textContent?.includes('s1'), `a refused read says only that it is not available: ${refused.textContent?.slice(0, 300)}`)
})

const recording = () => {
  const written: Record<string, unknown>[] = []
  const client = {
    create: async (input: Record<string, unknown>) => {
      written.push(input)
      return {}
    },
    update: async (input: Record<string, unknown>) => {
      written.push(input)
      return {}
    },
    delete: async () => ({}),
  }
  return { client, written }
}

test('33. a field the access report denies the write of is drawn disabled and is not in the write, so the chrome and the payload answer the same question once', async () => {
  // Both halves are asserted together: a form that disables a control but still sends its field is the drift this prevents.
  const { client, written } = recording()
  const host = await render(
    createElement(Form, {
      kayan: courses,
      client,
      value: { id: 'a-row', title: 'Tajweed', summary: 'A short summary', fee: 300, archived: false },
      t,
      locale: 'en',
      onDone: () => {},
      writes: (field: string) => field !== 'fee',
    }),
  )
  const fee = host.querySelector('#courses-fee') as unknown as HTMLInputElement
  assert.equal(fee.disabled, true, 'the denied field is drawn disabled')
  const title = host.querySelector('#courses-title') as unknown as HTMLInputElement
  assert.equal(title.disabled, false, 'and a field the report allows is not, so the report is being read rather than everything disabled')

  await act(async () => {
    typeInto(title, 'Tajweed II')
  })
  await act(async () => {
    fire(host.querySelector('form')!, 'submit')
  })
  assert.equal(written.length, 1, 'the form ran one write')
  assert.ok(!('fee' in written[0]!), 'and the denied field is not in it, though the row carried a value for it')
  assert.equal(written[0]!.title, 'Tajweed II', 'while the field the report allows is written')
})

test('34. a checkbox on a row that carries no value for it is left out of an update and seeded false only on a create, so a save nobody touched rewrites nothing', async () => {
  // A column the access report denies read of is absent from the loaded row. Seeding `false` would send `archived: false` on every save of a row whose stored value is `true`.
  const { client, written } = recording()
  const host = await render(
    createElement(Form, {
      kayan: courses,
      client,
      value: { id: 'a-row', title: 'Tajweed' },
      t,
      locale: 'en',
      onDone: () => {},
    }),
  )
  await act(async () => {
    fire(host.querySelector('form')!, 'submit')
  })
  assert.equal(written.length, 1, 'the form ran one write')
  assert.ok(!('archived' in written[0]!), 'the checkbox the row carries no value for contributes no key to the update')
  assert.equal(written[0]!.id, 'a-row', 'which is an update, not a create')

  // The create half: the box is drawn unchecked, and that is a value.
  const made = await render(
    createElement(Form, { kayan: courses, client, value: null, t, locale: 'en', onDone: () => {} }),
  )
  // The title, which the create requires, so the browser's own check lets it go.
  await act(async () => {
    typeInto(made.querySelector('#courses-title')!, 'Tajweed')
  })
  await act(async () => {
    fire(made.querySelector('form')!, 'submit')
  })
  assert.equal(written[1]!.notifications, false, 'a create still carries the box it drew')
  assert.ok(!('archived' in written[1]!), 'and none it never draws, archived being no create\'s')
})

test('35. a form handed another row seeds from that row, so a screen that navigates between two rows without unmounting writes neither row\'s values under the other\'s id', async () => {
  const { client, written } = recording()
  const host = mount()
  const root = createRoot(host)
  const formFor = (value: Record<string, unknown>) =>
    withComponents(createElement(Form, { kayan: courses, client, value, t, locale: 'en', onDone: () => {} }))

  await act(async () => {
    root.render(formFor({ id: 'first', title: 'Tajweed', summary: 'The first' }))
  })
  assert.equal((host.querySelector('#courses-title') as unknown as HTMLInputElement).value, 'Tajweed')

  // The same mounted tree, handed the second row: React keeps the component and its state, so only the re-seed puts the second row's values in the controls.
  await act(async () => {
    root.render(formFor({ id: 'second', title: 'Tafsir', summary: 'The second' }))
  })
  assert.equal(
    (host.querySelector('#courses-title') as unknown as HTMLInputElement).value,
    'Tafsir',
    'the controls show the row the form was handed and not the one before it',
  )
  await act(async () => {
    typeInto(host.querySelector('#courses-summary')!, 'The second, edited')
  })
  await act(async () => {
    fire(host.querySelector('form')!, 'submit')
  })
  assert.deepEqual(
    written[0],
    { id: 'second', summary: 'The second, edited' },
    'and a save writes the change made to the second row under the second row\'s id, and nothing of the first',
  )
})

test('36. a picker whose page read was refused says so, which is not the sentence it says when the target answered with no rows', async () => {
  // A target this actor may not read must not say "no rows match this filter", a sentence about a filter that had nothing to do with it.
  const course = sessions.fields.find((one) => one.name === 'course')!
  const open = async (api: FindApi) => {
    const host = await render(
      createElement(RelationshipControl, {
        values: {}, setValue: () => {},
        field: course,
        kayan: sessions,
        client: kayans,
        api,
        id: 'sessions-course',
        t,
        value: undefined,
        readOnly: false,
        onChange: () => {},
      }),
    )
    await act(async () => {
      click(host.querySelector('#sessions-course') as unknown as Element)
    })
    return host
  }

  await open(fakeApi({ courses: [] }).api)
  const empty = opened()?.textContent ?? ''
  assert.ok(empty.includes('No rows match this filter.'), `an answered read with no rows says so:\n${empty}`)

  await open({ courses: { find: async () => { throw new Error('Forbidden.') } } })
  const refused = opened()?.textContent ?? ''
  assert.ok(refused.includes('That list could not be read.'), `a refused read says that instead:\n${refused}`)
  assert.ok(!refused.includes('No rows match this filter.'), 'and never both')
})

test('37. adding a row to a panel that already holds a filter reports nothing to the host, so Add filter on page three leaves the page where it is', async () => {
  // A host resets to page one on `onChange`, so an added row that holds no value must not report the unchanged `where`.
  const { Filters } = await import('../registry/list-filters.tsx')
  const { filterPathsOf } = await import('../registry/filter-operators.ts')
  const reported: unknown[] = []
  const value = { or: [{ and: [{ title: { equals: 'Tajweed' } }] }] }
  const host = await render(
    createElement(Filters, {
      paths: filterPathsOf(courses, { client: kayans, locales: ['en'] }),
      value,
      onChange: (next: unknown) => reported.push(next),
      t,
      locale: 'en',
    }),
  )
  const add = [...host.querySelectorAll('button')].find((one) => one.textContent === 'Add filter')!
  await act(async () => {
    click(add as unknown as Element)
  })
  assert.equal(host.getAttribute('data-mithaq-filters') ?? host.querySelector('[data-mithaq-filters]')?.getAttribute('data-mithaq-filters'), '2', 'the panel now holds two rows')
  assert.deepEqual(reported, [], 'and reported nothing, because the filter it commits is the one the host already holds')

  // A row filled in is a change and is reported; the skip only guards a no-op.
  const values = [...host.querySelectorAll('input[aria-label="value"]')]
  await act(async () => {
    typeInto(values[1]!, 'Tafsir')
  })
  await debounced()
  assert.equal(reported.length, 1, 'the filled row reaches the host')
})

test('38. a reseed is keyed on the kayan and the id together, and clears a stale refusal along with the values', async () => {
  // The same id and a different kayan read as the same row and never reseeded.
  const { client: recorded, written } = recording()
  const refusing = {
    ...recorded,
    update: async () => {
      throw { data: { key: 'refused', params: { issues: [{ path: 'title', message: 'No.' }] } } }
    },
  }
  const host = mount()
  const root = createRoot(host)
  await act(async () => {
    root.render(withComponents(
      createElement(Form, {
        kayan: courses,
        client: refusing,
        value: { id: 'x', title: 'Tajweed', summary: 'A summary', fee: 100, archived: false },
        t,
        locale: 'en',
        onDone: () => {},
      }),
    ))
  })
  await act(async () => {
    fire(host.querySelector('form')!, 'submit')
  })
  assert.ok(host.querySelector('[role="alert"]'), 'the refused save is shown')

  await act(async () => {
    root.render(withComponents(
      createElement(Form, {
        kayan: sessions,
        client: recorded,
        value: { id: 'x', course: 'a-course', startsAt: '2026-01-01T00:00:00.000Z', capacity: 10 },
        t,
        locale: 'en',
        onDone: () => {},
      }),
    ))
  })
  assert.equal(host.querySelector('[role="alert"]'), null, 'the reseed clears the refusal the row before left behind')
  assert.equal(
    (host.querySelector('#sessions-capacity') as unknown as HTMLInputElement)?.value,
    '10',
    'and the new row\'s own values are seeded rather than the old row\'s, because the id alone read as no change',
  )
  await act(async () => {
    typeInto(host.querySelector('#sessions-capacity')!, '12')
  })
  await act(async () => {
    fire(host.querySelector('form')!, 'submit')
  })
  assert.deepEqual(written[0], { id: 'x', capacity: 12 }, 'the write carries the change to the reseeded row and not a value left over from the row before')
})

test('39. a non-numeric number and an uncalendared moment are reported as undefined rather than as a value that would clear the column', async () => {
  // `type="number"` refuses a value no number reads, so the DOM property is overwritten directly, as a bad `event.target.value` from elsewhere would be.
  const forceValue = (node: Element, text: string) => {
    Object.defineProperty(node, 'value', { value: text, configurable: true })
    fire(node, 'input')
  }
  for (const [kind, garbage] of [['number', 'not-a-number'], ['datetime', 'not-a-date']] as const) {
    const reported: unknown[] = []
    const host = await render(
      createElement(controls[kind]!, {
          values: {}, setValue: () => {},
        field: { name: 'probe', kind, rules: {} },
        kayan: courses,
        id: `probe-${kind}`,
        t,
        value: 'held',
        readOnly: false,
        onChange: (next: unknown) => reported.push(next),
      } as never),
    )
    await act(async () => {
      forceValue(host.querySelector('input')!, garbage)
    })
    // A moment's time boxes take digits alone, so letters forced into one report nothing at all.
    if (kind === 'datetime') {
      assert.deepEqual(reported, [], 'the moment control reported nothing that would clear the column')
      continue
    }
    assert.equal(reported.length, 1, `the ${kind} control reported the edit`)
    assert.equal(reported[0], undefined, 'and reported it as undefined rather than NaN')
  }
})

test('43. a row is picked by the keyboard alone: the list opens with its first row selected, an arrow moves the selection and Enter reports that row\'s id', async () => {
  // The combobox's input keeps the focus and reads ArrowDown, ArrowUp and Enter, so it is the element that carries `aria-activedescendant` and the id of the list.
  const { api } = fakeApi({ courses: [{ id: 'c1', title: 'Tajweed' }, { id: 'c2', title: 'Tafsir' }, { id: 'c3', title: 'Seerah' }] })
  const course = sessions.fields.find((one) => one.name === 'course')!
  const chosen: unknown[] = []
  const host = await render(
    createElement(RelationshipControl, {
        values: {}, setValue: () => {},
      field: course,
      kayan: sessions,
      client: kayans,
      api,
      id: 'sessions-course',
      t,
      value: undefined,
      readOnly: false,
      onChange: (next: unknown) => chosen.push(next),
    }),
  )
  await act(async () => {
    click(host.querySelector('#sessions-course') as unknown as Element)
  })
  const search = host.querySelector('#sessions-course') as unknown as Element
  assert.equal(search.getAttribute('role'), 'combobox', 'the box the popup opens on is a combobox')
  assert.equal(
    search.getAttribute('aria-controls'),
    opened()!.querySelector('[role="listbox"]')!.getAttribute('id'),
    'and it names the list it controls by that list\'s own id, which is generated inside the primitive and reachable from nowhere else',
  )
  const selected = () => opened()!.querySelector('[role="option"][data-highlighted]')
  assert.equal(selected()?.textContent, 'Tajweed', 'the first row is selected the moment the page arrives')
  // `aria-activedescendant` is the whole of what a screen reader is told, not the styling hook; `autoHighlight: 'always'` sets it before a key is pressed, so this fails if that cast is dropped.
  assert.equal(
    search.getAttribute('aria-activedescendant'),
    selected()!.getAttribute('id'),
    'and the box names it as its active descendant with no key pressed yet',
  )

  await act(async () => {
    press(search, 'ArrowDown')
  })
  assert.equal(selected()?.textContent, 'Tafsir', 'an arrow down moves the selection one row')
  assert.equal(
    search.getAttribute('aria-activedescendant'),
    selected()!.getAttribute('id'),
    'and the box names that row as its active descendant',
  )
  assert.deepEqual(chosen, [], 'while moving the selection is not choosing')

  await act(async () => {
    press(search, 'Enter')
  })
  assert.deepEqual(chosen, ['c2'], 'Enter reports the id of the selected row, with no pointer anywhere in this step')
  assert.equal(opened(), null, 'and the list closes behind it')
})

test('44. Escape leaves the picker with the selection it had, so a list opened by accident costs nothing', async () => {
  const { api } = fakeApi({ courses: [{ id: 'c1', title: 'Tajweed' }, { id: 'c2', title: 'Tafsir' }] })
  const course = sessions.fields.find((one) => one.name === 'course')!
  const chosen: unknown[] = []
  const host = await render(
    createElement(RelationshipControl, {
        values: {}, setValue: () => {},
      field: course,
      kayan: sessions,
      client: kayans,
      api,
      id: 'sessions-course',
      t,
      value: undefined,
      readOnly: false,
      onChange: (next: unknown) => chosen.push(next),
    }),
  )
  await act(async () => {
    click(host.querySelector('#sessions-course') as unknown as Element)
  })
  const search = host.querySelector('#sessions-course') as unknown as Element
  await act(async () => {
    press(search, 'ArrowDown')
  })
  await act(async () => {
    press(search, 'Escape')
  })
  assert.equal(opened(), null, 'Escape closes the list')
  assert.deepEqual(chosen, [], 'and reports nothing, although a row was selected when it closed')
})

test('45. the picker\'s two icon buttons carry the names the project wrote, so neither reads as a button with no name', async () => {
  // Both are an icon and nothing else and base-ui names neither, so the picker hands each a resolved label. The clear button is drawn only over a selection.
  const { api } = fakeApi({ courses: [{ id: 'c1', title: 'Tajweed' }, { id: 'c2', title: 'Tafsir' }] })
  const course = sessions.fields.find((one) => one.name === 'course')!
  const host = await render(
    createElement(RelationshipControl, {
        values: {}, setValue: () => {},
      field: course,
      kayan: sessions,
      client: kayans,
      api,
      id: 'sessions-course',
      t,
      value: 'c1',
      readOnly: false,
      onChange: () => {},
    }),
  )
  const clear = host.querySelector('[data-slot="combobox-clear"]')
  assert.ok(clear, 'the picker draws the clear button over a selection')
  assert.equal(clear!.getAttribute('aria-label'), t('admin.clear', 'Clear'), 'and it is named with the project\'s own word for it')

  // Matched on what the trigger is, not `data-slot`: the addon composes the trigger into its own button and sets that attribute last. It is hidden by a class while the clear button is there, yet rendered.
  const trigger = host.querySelector('button[aria-haspopup="listbox"]')
  assert.ok(trigger, 'and the trigger beside it')
  assert.equal(
    trigger!.getAttribute('aria-label'),
    t('admin.showOptions', 'Show options'),
    'named with the project\'s own word for what it opens',
  )
})

test('54. Save is not offered until a value has changed, and Cancel is a callback the host decides the destination of', async () => {
  // A form that changed nothing has nothing to write, and a pressable Save would write the row back as it was. Cancel leaves through a callback, so the form imports no router.
  let cancelled = 0
  const client = { create: async () => ({}), update: async () => ({}), delete: async () => ({}) }
  const host = await render(
    createElement(Form, {
      kayan: courses,
      client,
      value: { id: 'a-row', title: 'Tajweed', summary: 'A short summary', fee: 300, archived: false },
      t,
      locale: 'en',
      onDone: () => {},
      onCancel: () => {
        cancelled += 1
      },
    }),
  )
  const save = host.querySelector('button[type="submit"]') as HTMLButtonElement
  assert.ok(save, 'the form draws a save button')
  assert.equal(save.disabled, true, 'which is disabled while nothing has changed')

  await act(async () => {
    typeInto(host.querySelector('#courses-title')!, 'Tajweed II')
  })
  assert.equal((host.querySelector('button[type="submit"]') as HTMLButtonElement).disabled, false, 'and becomes pressable on the first change')

  await act(async () => {
    typeInto(host.querySelector('#courses-title')!, 'Tajweed')
  })
  assert.equal(
    (host.querySelector('button[type="submit"]') as HTMLButtonElement).disabled,
    true,
    'and is not offered again once every value is back to what it was',
  )

  const cancel = [...host.querySelectorAll('button')].find((one) => one.textContent === 'Cancel')
  assert.ok(cancel, 'the form draws a cancel beside it')
  await act(async () => {
    click(cancel)
  })
  assert.equal(cancelled, 1, 'and pressing it asks the host to go back')

  const bare = await render(
    createElement(Form, { kayan: courses, client, value: null, t, locale: 'en', onDone: () => {} }),
  )
  assert.equal(
    [...bare.querySelectorAll('button')].some((one) => one.textContent === 'Cancel'),
    false,
    'a form with no onCancel draws no cancel button',
  )
})

test('55. a form holding an unsaved change asks the browser before the page is left, and stops asking once it is clean', async () => {
  // A closed tab or a back button takes the unsaved edit with it. The browser writes the sentence; a page only says whether to ask.
  const client = { create: async () => ({}), update: async () => ({}), delete: async () => ({}) }
  const host = await render(
    createElement(Form, {
      kayan: courses,
      client,
      value: { id: 'a-row', title: 'Tajweed', summary: 'A short summary', fee: 300, archived: false },
      t,
      locale: 'en',
      onDone: () => {},
    }),
  )
  assert.equal(window.onbeforeunload, null, 'an untouched form asks nothing')

  await act(async () => {
    typeInto(host.querySelector('#courses-title')!, 'Tajweed II')
  })
  assert.equal(typeof window.onbeforeunload, 'function', 'a form holding a change asks before the page is left')

  await act(async () => {
    typeInto(host.querySelector('#courses-title')!, 'Tajweed')
  })
  assert.equal(window.onbeforeunload, null, 'and stops asking once the change is undone')

  // A form that is left behind does not hold the guard for the screen after it.
  await act(async () => {
    typeInto(host.querySelector('#courses-title')!, 'Tajweed III')
  })
  assert.equal(typeof window.onbeforeunload, 'function', 'the guard is armed again')
  // Unmounted with nothing put in its place: a replacement form is clean and would null the guard itself, so the step would pass whether the cleanup ran or not.
  await act(async () => {
    mounted!.unmount()
    mounted = undefined
  })
  assert.equal(window.onbeforeunload, null, 'and is cleared when the form goes away')
})

test('56. Cancel on a form holding an unsaved change asks before it discards, and Cancel on a clean form leaves at once', async () => {
  // `onbeforeunload` does not see a router navigation, so Cancel on a dirty form asks through the same dialog the delete uses.
  const client = { create: async () => ({}), update: async () => ({}), delete: async () => ({}) }
  const cancelled: number[] = []
  const row = { id: 'a-row', title: 'Tajweed', summary: 'A short summary', fee: 300, archived: false }
  const mountForm = () =>
    render(
      createElement(Form, {
        kayan: courses,
        client,
        value: row,
        t,
        locale: 'en',
        onDone: () => {},
        onCancel: () => cancelled.push(1),
      }),
    )

  // Clean: the button is a button, not a dialog trigger, and one click leaves.
  let host = await mountForm()
  const cancelOf = (where: ParentNode) =>
    [...where.querySelectorAll('button')].find((one) => one.textContent === 'Cancel')!
  const clean = cancelOf(host)
  assert.ok(clean, 'a form with a host that handed onCancel draws the button')
  assert.equal(clean.getAttribute('aria-haspopup'), null, 'which opens no dialog while the form is clean')
  await act(async () => {
    click(clean as unknown as Element)
  })
  assert.deepEqual(cancelled, [1], 'and the one click leaves')

  // Dirty: the same button is the dialog's trigger; the first click discards nothing and the confirm inside it leaves.
  host = await mountForm()
  await act(async () => {
    typeInto(host.querySelector('#courses-title')!, 'Tajweed II')
  })
  const dirty = cancelOf(host)
  assert.equal(dirty.getAttribute('aria-haspopup'), 'dialog', 'a change turns the same button into the dialog\'s trigger')
  await act(async () => {
    click(dirty as unknown as Element)
  })
  assert.deepEqual(cancelled, [1], 'and opening the dialog discards nothing')
  const dialog = window.document.querySelector('[data-slot="alert-dialog-content"]')
  assert.ok(dialog, 'the first click opens the dialog')
  const confirm = dialog!.querySelector('[data-slot="alert-dialog-action"]')!
  await act(async () => {
    click(confirm as unknown as Element)
  })
  assert.deepEqual(cancelled, [1, 1], 'the second click is the one that leaves')
})

test('57. a save that lands clears the change it wrote, so the form is no longer holding one', async () => {
  // After a save lands the form re-seeds; otherwise it still reports a change, offers Save again and holds the unload guard for a saved row.
  const client = { create: async () => ({}), update: async () => ({}), delete: async () => ({}) }
  const host = await render(
    createElement(Form, {
      kayan: courses,
      client,
      value: { id: 'a-row', title: 'Tajweed', summary: 'A short summary', fee: 300, archived: false },
      t,
      locale: 'en',
      onDone: () => {},
    }),
  )
  const save = [...host.querySelectorAll('button')].find((one) => one.textContent?.includes('Save'))!
  assert.equal(save.disabled, true, 'an untouched form offers no save')
  await act(async () => {
    typeInto(host.querySelector('#courses-title')!, 'Tajweed II')
  })
  assert.equal(save.disabled, false, 'a change offers one')
  assert.equal(typeof window.onbeforeunload, 'function', 'and arms the unload guard')

  await act(async () => {
    click(save as unknown as Element)
  })
  assert.equal(save.disabled, true, 'the save that landed leaves nothing more to save')
  assert.equal(window.onbeforeunload, null, 'and nothing for the browser to ask about')
})

test('a datetime the plain text input draws is edited, saved through the fetch plug and read back as the same instant', async () => {
  // A datetime drawn with the plain `text` control must show the shape the fetch plug decodes back into a `Date`; `String(date)` would be posted and refused by `z.date()`.
  // The operation behind the plug is `sessions.update` with its call replaced by the parse the runner makes first, so no store is needed.
  const update = asas.operations.find((one) => one.kayan === 'sessions' && one.name === 'update')!
  const plug = fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })([{ ...update, call: async (input: unknown) => update.input['~standard'].validate(input) }])
  const answers: Record<string, unknown>[] = []
  const post = async (input: Record<string, unknown>) => {
    const response = await plug.handle(new Request('http://mithaq.test/api/sessions/update', { method: 'POST', body: JSON.stringify(input) }), async () => null)
    answers.push(await response!.json() as Record<string, unknown>)
    return {}
  }
  const kayan = {
    ...sessions,
    fields: sessions.fields
      .filter((one) => one.name === 'id' || one.name === 'startsAt')
      .map((one) => (one.kind === 'datetime' ? { ...one, component: 'text' } : one)),
  }
  const stored = '2026-09-24T10:30:00.000Z'
  const host = await render(
    createElement(Form, {
      kayan,
      client: { create: post, update: post, delete: async () => ({}) },
      value: { id: '00000000-0000-4000-8000-000000000000', startsAt: stored },
      t,
      locale: 'en',
      onDone: () => {},
    }),
  )
  const box = host.querySelector('#sessions-startsAt') as HTMLInputElement
  assert.equal(box.value, stored, 'the box draws the stored moment as the ISO string it arrived as')
  const shown = box.value
  await act(async () => typeInto(box, `${shown}x`))
  await act(async () => typeInto(box, shown))
  await act(async () => fire(host.querySelector('form')!, 'submit'))
  assert.equal(answers.length, 1, 'the form ran one write')
  const value = (answers[0] as { value?: { startsAt?: unknown } }).value
  assert.ok(value, `the declared shape took the write: ${JSON.stringify(answers[0])}`)
  assert.equal(value.startsAt, stored, 'and read it as the instant the row held')
})

test('60. a field that holds many rows picks into a chip list, a chip removes the row it names, and the form writes the whole array', async () => {
  // `courses.tags` is the template's one many-to-many (`hasMany`), which the picker branches on.
  const tags = courses.fields.find((one) => one.name === 'tags')!
  assert.equal(tags.hasMany, true, 'the projection says this field holds a set, which is what the picker branches on')

  const { api, calls } = fakeApi({
    tags: [
      { id: 't1', name: 'Recitation' },
      { id: 't2', name: 'Grammar' },
      { id: 't3', name: 'History' },
    ],
  })
  const { client, written } = recording()
  const host = await render(
    createElement(Form, {
      kayan: courses,
      client,
      kayans,
      api,
      value: { id: 'a-row', title: 'Tajweed', tags: [] },
      t,
      locale: 'en',
      onDone: () => {},
    }),
  )

  const box = () => host.querySelector('#courses-tags') as unknown as HTMLInputElement
  const chips = () => [...host.querySelectorAll('[data-slot="combobox-chip"]')]
  assert.ok(box(), 'the field draws a box of its own')
  assert.equal(chips().length, 0, 'holding nothing to begin with')

  // The picker stays open between picks, and each pick leaves the row out of the next page's `not_in`.
  await act(async () => {
    click(box() as unknown as Element)
  })
  await act(async () => {
    click(opened()!.querySelectorAll('[data-slot="combobox-item"]')[0]! as unknown as Element)
  })
  await act(async () => {
    click(opened()!.querySelectorAll('[data-slot="combobox-item"]')[0]! as unknown as Element)
  })
  assert.deepEqual(
    chips().map((chip) => chip.textContent),
    ['Recitation', 'Grammar'],
    'both chosen rows are drawn as chips, named by the target\'s own title',
  )
  const pages = calls.filter((call) => (call.input.where as { id?: { not_in?: unknown } }).id?.not_in !== undefined)
  assert.deepEqual(
    pages.at(-1)!.input.where,
    { id: { not_in: ['t1', 't2'] } },
    'and every chosen row is kept off the page, not only the last one',
  )

  // base-ui removes a chip by its position, so the chips are rendered in the order the value holds.
  await act(async () => {
    click(chips()[0]!.querySelector('[data-slot="combobox-chip-remove"]')! as unknown as Element)
  })
  assert.deepEqual(chips().map((chip) => chip.textContent), ['Grammar'], 'the chip that was removed is gone and the other stays')

  await act(async () => {
    fire(host.querySelector('form')!, 'submit')
  })
  assert.equal(written.length, 1, 'the form ran one write')
  assert.deepEqual(written[0]!.tags, ['t2'], 'carrying the whole set as an array of ids, which is what the store writes over the join table')

  // An emptied set is the empty array, never `null`: the store writes the array it is handed, which is how a person takes every row off the field.
  await act(async () => {
    click(chips()[0]!.querySelector('[data-slot="combobox-chip-remove"]')! as unknown as Element)
  })
  await act(async () => {
    fire(host.querySelector('form')!, 'submit')
  })
  assert.deepEqual(written[1]!.tags, [], 'a set emptied by hand is written as the empty array')
})

test('61. a relationship column naming many rows counts the ones it has no room for, and each of the three states reads differently', async () => {
  // The cell reads the ids off the value whatever its shape, so a `hasMany` column is one batched read per target, never one per cell.
  const { api, calls } = fakeApi({
    tags: [
      { id: 't1', name: 'Recitation' },
      { id: 't2', name: 'Grammar' },
      { id: 't3', name: 'History' },
      { id: 't4', name: 'Tafsir' },
    ],
  })
  const docs = [
    { id: 'c1', title: 'Tajweed', tags: ['t1', 't2', 't3', 't4'] },
    { id: 'c2', title: 'Nahw', tags: ['t2'] },
    { id: 'c3', title: 'Sarf', tags: [] },
  ]
  const host = await render(
    createElement(List, {
      kayan: courses,
      client: kayans,
      api,
      page: { docs, hasNextPage: false, hasPrevPage: false, limit: 10, nextPage: null, page: 1, prevPage: null, totalDocs: 3, totalPages: 1 },
      query: { cols: ['title', 'tags'] },
      t,
      locale: 'en',
      onQuery: () => {},
      href: (id: string) => `/courses/${id}`,
      newHref: '/courses/new',
    }),
  )
  assert.equal(calls.length, 1, `four ids over three rows is one read: ${JSON.stringify(calls.map((one) => one.target))}`)
  assert.deepEqual(
    calls[0]!.input,
    { where: { id: { in: ['t1', 't2', 't3', 't4'] } }, limit: 4 },
    'each id once, and the limit is the count asked for, so the answer can never be short of its own question',
  )
  assert.ok(host.textContent?.includes('Recitation, Grammar, History'), 'the first three rows are named')
  assert.ok(host.textContent?.includes('and 1 more'), 'and the fourth is counted rather than named')
  assert.ok(!host.textContent?.includes('Tafsir'), 'so the fourth name is not in the table')
  assert.ok(!host.textContent?.includes('t1'), 'and no cell shows the id it holds, because the read answered for every one')

  // A row holding no ids renders nothing rather than the word for an empty array. Read off that row's own tags cell: a column the URL does not name keeps the declaration's answer.
  const heads = [...host.querySelectorAll('thead th')].map((one) => one.textContent)
  const at = heads.findIndex((one) => one?.includes('Tags'))
  assert.ok(at >= 0, `the tags column is in the table: ${heads.join(', ')}`)
  const row = [...host.querySelectorAll('tbody tr')].find((one) => one.textContent?.includes('Sarf'))!
  assert.equal([...row.querySelectorAll('td')][at]!.querySelector('[data-list-value]')!.textContent, '', 'a row that points at nothing has an empty cell')
})

test('a hasMany holding 101 ids is read in pieces the HTTP read cap admits, so the cell and the picker still name every row', async () => {
  const many = Array.from({ length: 101 }, (_, at) => ({ id: `t${at}`, name: `Tag ${at}` }))
  const ids = many.map((row) => row.id)
  const { api, calls } = fakeApi({ tags: many })
  const underCap = () => calls.every((call) => typeof call.input.limit === 'number' && call.input.limit <= screen.maxLimit)

  const table = await render(
    createElement(List, {
      kayan: courses,
      client: kayans,
      api,
      page: { docs: [{ id: 'c1', title: 'Tajweed', tags: ids }], hasNextPage: false, hasPrevPage: false, limit: 10, nextPage: null, page: 1, prevPage: null, totalDocs: 1, totalPages: 1 },
      query: { cols: ['title', 'tags'] },
      t,
      locale: 'en',
      onQuery: () => {},
      href: (id: string) => `/courses/${id}`,
      newHref: '/courses/new',
    }),
  )
  assert.ok(underCap(), `no read asks past the cap: ${JSON.stringify(calls.map((call) => call.input.limit))}`)
  assert.ok(table.textContent?.includes('Tag 0, Tag 1, Tag 2'), 'the cell names its first rows')
  assert.ok(table.textContent?.includes('and 98 more'), 'and counts the rest')

  calls.length = 0
  const picker = await render(
    createElement(RelationshipControl, {
      field: courses.fields.find((one) => one.name === 'tags')!,
      values: {},
      setValue: () => {},
      kayan: courses,
      client: kayans,
      api,
      id: 'courses-tags',
      t,
      value: ids,
      readOnly: false,
      onChange: () => {},
    }),
  )
  assert.ok(underCap(), `no read asks past the cap: ${JSON.stringify(calls.map((call) => call.input.limit))}`)
  const chips = [...picker.querySelectorAll('[data-slot="combobox-chip"]')].map((one) => one.textContent)
  assert.equal(chips.length, 101, 'every id held is a chip')
  assert.ok(chips.some((one) => one?.includes('Tag 100')), 'and the last one is named, not left as its id')
})

test('a build whose maxLimit is 5 opens a list with no limit of the registry\'s own, offers a page of 5 and searches at most 5', async () => {
  const five = { screen: { ...screen, maxLimit: 5 } }
  // The list asks for no page size, so the server's `defaultLimit`, which the build holds to `maxLimit`, answers.
  assert.equal(findOf({ kayan: courses, query: {} }).limit, undefined, 'a list opens with the server\'s own page')
  const pager = await render(createElement(Pagination, { page: { ...pageOf([]), limit: 5 }, onPage: () => {}, onLimit: () => {}, t, locale: 'en' }), five)
  await act(async () => click(pager.querySelector('[data-slot="select-trigger"]') as Element))
  assert.deepEqual([...window.document.querySelectorAll('[data-slot="select-item"]')].map((one) => one.textContent), ['5'])
  const { api, calls } = fakeApi({ courses: [{ id: 'c1', title: 'Tajweed' }] })
  const host = await render(
    createElement(RelationshipControl, {
      values: {}, setValue: () => {}, field: sessions.fields.find((one) => one.name === 'course')!, kayan: sessions, client: kayans, api,
      id: 'sessions-course', t, value: null, readOnly: false, onChange: () => {},
    }),
    five,
  )
  await act(async () => click(host.querySelector('#sessions-course') as unknown as Element))
  assert.ok(calls.length > 0 && calls.every((call) => call.input.limit === 5), `every search asks for 5: ${JSON.stringify(calls.map((call) => call.input.limit))}`)
  // The home page's loader asks for no more than 5, since one read past it rejects the whole loader.
  const asked: unknown[] = []
  await dashboardLoader({
    client: async ({ operation, input }) => (asked.push(input.limit), operation === 'count' ? { totalDocs: 0 } : { docs: [], totalPages: 1 }),
    access: { collections: { courses: { read: true }, enrollments: { read: true }, sessions: { read: true, fields: { startsAt: { read: true }, course: { read: true } } } } } as never,
    request: fetch,
    maxLimit: 5,
  })
  assert.ok(asked.includes(5) && asked.every((one) => one === undefined || (one as number) <= 5), `the loader asks for at most 5: ${JSON.stringify(asked)}`)
})

test('the template\'s own page reads ask at the build\'s maxLimit: a role\'s delete, so a smaller one is no swallowed 400 that reads as no holders, the members loader and the backoffice\'s role cell', async () => {
  const limits: unknown[] = []
  const client: ScreenState['client'] = async ({ input }) => {
    limits.push(input.limit)
    return { docs: [] }
  }
  const host = await render(createElement(DeleteRole, { run: async () => {}, busy: false } as never), { screen: { ...screen, maxLimit: 5 }, record: { id: 'r1', name: 'teacher' }, client })
  await act(async () => click(host.querySelector('[data-button="delete"]') as Element))
  assert.deepEqual(limits, [5], `the holders are read at 5: ${JSON.stringify(limits)}`)

  limits.length = 0
  await membersLoader({ client, access: { permissions: '*' } as never, request: async (path) => Response.json(path.includes('list-invitations') ? [] : { members: [] }), maxLimit: 5 })
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await render(createElement(QueryClientProvider, { client: queries }, createElement(RoleName, { value: 'custom', row: { role: 'custom' } } as never)), { screen: { ...screen, maxLimit: 5 }, client })
  await act(async () => sleep(20))
  queries.clear()
  assert.ok(limits.length === 3 && limits.every((one) => one === 5), `every read asks for 5: ${JSON.stringify(limits)}`)
})

test('a screen whose build names maxLimit 50 offers no page size past it and never asks past it', async () => {
  // The number is the build's, carried on the projection, not a constant of the browser's.
  assert.equal(screen.maxLimit, 100, 'the template\'s screen carries the template\'s maxLimit')
  const fifty = { screen: { ...screen, maxLimit: 50 } }

  const pager = await render(createElement(Pagination, { page: pageOf([]), onPage: () => {}, onLimit: () => {}, t, locale: 'en' }), fifty)
  await act(async () => click(pager.querySelector('[data-slot="select-trigger"]') as Element))
  const sizes = [...window.document.querySelectorAll('[data-slot="select-item"]')].map((one) => one.textContent)
  assert.deepEqual(sizes, ['10', '25', '50'], 'no 100 page size is offered')

  // A link or a remembered size past it is dropped rather than sent.
  const rules = rulesOf({ kayan: courses, node: undefined, maxLimit: 50 })
  assert.equal(readQuery(new URLSearchParams('limit=100'), rules).limit, undefined, 'a link asking for 100 is read without its limit')
  assert.equal(readQuery(new URLSearchParams('limit=50'), rules).limit, 50)
  window.localStorage.setItem('mithaq.list.courses', JSON.stringify({ limit: 100 }))
  assert.equal(remembered('courses', 50).limit, undefined, 'a remembered 100 is not sent')
  window.localStorage.removeItem('mithaq.list.courses')

  const many = Array.from({ length: 101 }, (_, at) => ({ id: `t${at}`, name: `Tag ${at}` }))
  const ids = many.map((row) => row.id)
  const { api, calls } = fakeApi({ tags: many })
  assert.equal((await findByIds({ reads: api.tags!, ids, maxLimit: 50 })).length, 101, 'every row is read')
  assert.deepEqual(calls.map((call) => call.input.limit), [50, 50, 1], 'in pieces of at most 50')
  calls.length = 0
  await render(
    createElement(RelationshipControl, {
      field: courses.fields.find((one) => one.name === 'tags')!,
      values: {}, setValue: () => {}, kayan: courses, client: kayans, api, id: 'courses-tags', t, value: ids, readOnly: false, onChange: () => {},
    }),
    fifty,
  )
  assert.ok(calls.length > 0 && calls.every((call) => typeof call.input.limit === 'number' && call.input.limit <= 50), `no read asks past 50: ${JSON.stringify(calls.map((call) => call.input.limit))}`)

  const limits: unknown[] = []
  await dashboardLoader({
    client: async ({ operation, input }) => (limits.push(input.limit), operation === 'count' ? { totalDocs: 0 } : { docs: [], totalPages: 1 }),
    access: { collections: { courses: { read: true }, enrollments: { read: true } } },
    request: fetch,
    maxLimit: 50,
  })
  assert.ok(limits.includes(50) && limits.every((one) => one === undefined || (one as number) <= 50), `the loader asks for 50 at a time: ${JSON.stringify(limits)}`)
})

const listScreen = () => screenOf(courses.pages.list!)
const pageOf = (docs: Record<string, unknown>[]) => ({ docs, hasNextPage: false, hasPrevPage: false, limit: 10, nextPage: null, page: 1, prevPage: null, totalDocs: docs.length, totalPages: 1 })

test('64. ticking rows and running a bulk button sends one call naming exactly those ids, and the selection is dropped once it lands', async () => {
  const calls: { operation: string; input: Record<string, unknown> }[] = []
  const docs = [
    { id: 'c1', title: 'Tajweed', fee: 300, archived: false },
    { id: 'c2', title: 'Nahw', fee: 200, archived: false },
    { id: 'c3', title: 'Sarf', fee: 100, archived: false },
  ]
  const host = await render(
    createElement(List, {
      kayan: courses,
      page: pageOf(docs),
      query: {},
      t,
      locale: 'en',
      onQuery: () => {},
      href: (id: string) => `/courses/${id}`,
      newHref: '/courses/new',
      screen: listScreen(),
      operations: { deleteMany: true, updateMany: true },
      run: async (operation: string, input: Record<string, unknown>) => {
        calls.push({ operation, input })
        return {}
      },
    }),
  )
  const boxes = () => [...host.querySelectorAll('table [role="checkbox"]')]
  const count = () => host.querySelector('[data-mithaq-selected]')?.getAttribute('data-mithaq-selected')
  assert.equal(boxes().length, docs.length + 1, 'the table is one checkbox per row under one at the head of the column')
  assert.equal(count(), undefined, 'nothing is ticked to begin with, so nothing is counted')
  const button = (text: string) => [...host.querySelectorAll('button')].find((one) => one.textContent?.trim() === text)!
  assert.equal(button('Delete').closest('[hidden]') !== null, true, 'and no bulk button is offered over no ticked row')

  // Two of the three, the state the head box has to report as mixed.
  await act(async () => {
    click(boxes()[1]! as unknown as Element)
  })
  await act(async () => {
    click(boxes()[2]! as unknown as Element)
  })
  assert.equal(count(), '2', 'two rows ticked is a count of two')
  assert.equal(boxes()[0]!.getAttribute('aria-checked'), 'mixed', 'and the head box says part of the page rather than all or none')

  await act(async () => {
    click(button('Delete') as unknown as Element)
  })
  assert.equal(calls.length, 0, 'the click asks the node\'s confirm and calls nothing yet')
  const asked = await confirmYes()
  assert.ok(asked?.includes('Delete the ticked courses?'), 'in the words the page wrote, in the app\'s own dialog')
  assert.deepEqual(
    calls,
    [{ operation: 'deleteMany', input: { where: { id: { in: ['c1', 'c2'] } } } }],
    'naming the operation by its own key and exactly the ids that were ticked',
  )
  assert.equal(count(), undefined, 'and the ticked set is dropped, because the host is about to read the page again, and the count with it')
})

test('65. a bulk update writes the fields its button names over the same ids, as the row data, through the control the form resolves each with', async () => {
  const calls: { operation: string; input: Record<string, unknown> }[] = []
  const docs = [{ id: 'c1', title: 'Tajweed' }, { id: 'c2', title: 'Nahw' }]
  const host = await render(
    createElement(List, {
      kayan: courses,
      page: pageOf(docs),
      query: {},
      t,
      locale: 'en',
      onQuery: () => {},
      href: (id: string) => `/courses/${id}`,
      newHref: '/courses/new',
      screen: listScreen(),
      operations: { updateMany: true },
      // The button names fee and archived, and this actor may write fee alone.
      writes: (field: string) => field === 'fee',
      run: async (operation: string, input: Record<string, unknown>) => {
        calls.push({ operation, input })
        return {}
      },
    }),
  )
  const boxes = () => [...host.querySelectorAll('[role="checkbox"]')]
  await act(async () => {
    click(boxes()[0]! as unknown as Element)
  })
  assert.equal(host.querySelector('[data-mithaq-selected]')?.getAttribute('data-mithaq-selected'), '2', 'the head box ticks the whole page')

  const button = (text: string) => [...host.querySelectorAll('button')].find((one) => one.textContent?.trim() === text)!
  await act(async () => {
    click(button('Update') as unknown as Element)
  })
  const dialog = () => window.document.querySelector('[data-slot="alert-dialog-content"]')
  // This file's `t` answers every key with its fallback, so the plural is the kayan's own name, begun in capitals.
  assert.ok(dialog()?.textContent?.includes('Courses you ticked: 2. This applies to each of them.'), 'the dialog names how many rows it is about, by the kayan\'s plural')
  const value = dialog()!.querySelector('#courses-updateMany-fee') as unknown as HTMLInputElement
  assert.ok(value, 'and holds the one field the button names that this actor may write')
  assert.equal(dialog()!.querySelector('#courses-updateMany-archived'), null, 'and not the one it may not')
  await act(async () => {
    typeInto(value, '450')
  })
  await act(async () => {
    fire(dialog()!.querySelector('form') as unknown as Element, 'submit')
  })
  assert.deepEqual(
    calls,
    [{ operation: 'updateMany', input: { where: { id: { in: ['c1', 'c2'] } }, data: { fee: 450 } } }],
    'carrying what was typed as the row data and the same ids the delete would have named',
  )
})

test('a bulk update can leave required and optional selects and cleared text unchanged', async () => {
  const { OperationButton } = await import('../registry/operation-button.tsx')
  for (const locale of ['en', 'ar']) {
    const sent: Record<string, unknown>[] = []
    await render(createElement(OperationButton, {
      busy: false, copy: { t: appCopy(locale), locale }, open: true, onOpenChange: () => {},
      kayan: courses, inputOf: (values) => ({ where: { id: { in: ['c1', 'c2'] } }, data: values }),
      operation: { name: 'updateMany', effect: 'update', updatesMany: true, label: { en: 'Update', ar: 'تحديث' }, fields: [
        ...[true, false].map((required) => fieldOf({ name: required ? 'currency' : 'venue', kind: 'text', component: 'select', rules: { required }, options: [{ value: 'SAR', label: { en: 'Riyal', ar: 'ريال' } }] })),
        fieldOf({ name: 'title', kind: 'text' }), fieldOf({ name: 'fee', kind: 'number' }),
      ] },
      run: async (input) => (sent.push(input), true),
    }))
    const dialog = window.document.querySelector('[data-slot="alert-dialog-content"]')! as unknown as Element
    const choose = async (name: string, label: string) => {
      await act(async () => click(dialog.querySelector(`#courses-updateMany-${name}`)!))
      const item = [...window.document.querySelectorAll('[data-slot="select-item"]')].find((one) => one.textContent === label)
      assert.ok(item, `the bulk select offers ${label}`)
      await act(async () => click(item as unknown as Element))
    }
    for (const name of ['currency', 'venue']) {
      await choose(name, locale === 'en' ? 'Riyal' : 'ريال')
      await choose(name, locale === 'en' ? 'Leave as is' : 'اتركه كما هو')
    }
    const title = dialog.querySelector('#courses-updateMany-title')!
    await act(async () => typeInto(title, 'Changed'))
    await act(async () => typeInto(title, ''))
    await act(async () => fire(dialog.querySelector('form')!, 'submit'))
    assert.deepEqual(sent, [], 'returning every field to empty leaves nothing to write')
    assert.ok(dialog.querySelector('[role="alert"]'), 'the empty bulk remains open with a refusal')
    await act(async () => typeInto(dialog.querySelector('#courses-updateMany-fee')!, '450'))
    await act(async () => fire(dialog.querySelector('form')!, 'submit'))
    assert.deepEqual(sent, [{ where: { id: { in: ['c1', 'c2'] } }, data: { fee: 450 } }], 'cleared fields are omitted from the data sent to every ticked row')
  }
})

test('65b. a bulk button that asks for fields and carries a confirm says both what it asks and how many rows it runs on', async () => {
  // The confirm's body and the ticked count are one dialog's two sentences, neither in place of the other.
  const { listOf } = await import('../registry/node-tree.ts')
  const node = listOf(listScreen())!
  const bulk = [{ button: 'updateMany', label: { en: 'Update', ar: 'تحديث' }, fields: ['fee'], confirm: { title: { en: 'Reprice?', ar: 'إعادة التسعير؟' }, body: { en: 'Every ticked course takes the new fee.', ar: 'تأخذ كل دورة محددة الرسوم الجديدة.' } } }]
  const host = await render(
    createElement(List, {
      kayan: courses,
      page: pageOf([{ id: 'c1', title: 'Tajweed' }, { id: 'c2', title: 'Nahw' }]),
      query: {},
      t,
      locale: 'en',
      onQuery: () => {},
      href: (id: string) => `/courses/${id}`,
      newHref: '/courses/new',
      screen: listScreen(),
      node: { ...node, bulk },
      operations: { updateMany: true },
      writes: () => true,
      run: async () => ({}),
    }),
  )
  await act(async () => {
    click(host.querySelectorAll('[role="checkbox"]')[0]! as unknown as Element)
  })
  await act(async () => {
    click([...host.querySelectorAll('button')].find((one) => one.textContent?.trim() === 'Update')! as unknown as Element)
  })
  const said = window.document.querySelector('[data-slot="alert-dialog-content"]')?.textContent ?? ''
  assert.equal(said.includes('Reprice?'), true, 'the confirm is the heading')
  assert.equal(said.includes('Every ticked course takes the new fee.'), true, 'its body is said')
  assert.equal(said.includes('Courses you ticked: 2. This applies to each of them.'), true, 'and so is how many rows it runs on')
})

test('215h. a bulk update says only the boxes filled in change, and with none filled it is refused in the dialog and nothing is sent', async () => {
  const calls: unknown[] = []
  const host = await render(
    createElement(List, {
      kayan: courses,
      page: pageOf([{ id: 'c1', title: 'Tajweed' }, { id: 'c2', title: 'Nahw' }]),
      query: {},
      t,
      locale: 'en',
      onQuery: () => {},
      href: (id: string) => `/courses/${id}`,
      newHref: '/courses/new',
      screen: listScreen(),
      operations: { updateMany: true },
      writes: () => true,
      run: async (operation: string) => void calls.push(operation),
    }),
  )
  await act(async () => click(host.querySelectorAll('[role="checkbox"]')[0]! as unknown as Element))
  await act(async () => click([...host.querySelectorAll('button')].find((one) => one.textContent?.trim() === 'Update')! as unknown as Element))
  const dialog = () => window.document.querySelector('[data-slot="alert-dialog-content"]')
  assert.equal(dialog()?.textContent?.includes('Only the fields you fill in change.'), true, 'the dialog says only the filled fields change')
  await act(async () => fire(dialog()!.querySelector('form') as unknown as Element, 'submit'))
  assert.deepEqual(calls, [], 'with nothing filled nothing is sent')
  assert.equal(dialog()?.querySelector('[role="alert"]')?.textContent, 'Fill in at least one field.', 'and the dialog says why')
  await act(async () => mounted?.unmount())
  mounted = undefined

  // An operation of the project's own whose input is `{ data }` is not a bulk update, so its dialog sends with every box empty.
  const { OperationButton } = await import('../registry/operation-button.tsx')
  const sent: unknown[] = []
  await render(createElement(OperationButton, {
    busy: false,
    copy: { t, locale: 'en' },
    open: true,
    onOpenChange: () => {},
    inputOf: (values: Record<string, unknown>) => ({ data: values }),
    kayan: courses,
    operation: { name: 'note', effect: 'update', label: { en: 'Note', ar: 'ملاحظة' }, fields: courses.fields.filter((one) => one.name === 'fee') },
    run: async (input: Record<string, unknown>) => (sent.push(input), true),
  } as never))
  await act(async () => fire(dialog()!.querySelector('form') as unknown as Element, 'submit'))
  assert.deepEqual(sent, [{ data: {} }], 'an operation that is no bulk update sends its empty boxes')
  await act(async () => mounted?.unmount())
  mounted = undefined

  // A bulk update with no box fills its own `data` in a step, so it sends its `where` and says nothing about boxes; one with a box still refuses it empty.
  const bulkSent: unknown[] = []
  const bulk = async (fields: readonly unknown[]) => {
    bulkSent.length = 0
    await render(createElement(OperationButton, {
      busy: false,
      copy: { t, locale: 'en' },
      open: true,
      onOpenChange: () => {},
      inputOf: (values: Record<string, unknown>) => ({ where: { id: { in: ['s1'] } }, ...(fields.length > 0 && { data: values }) }),
      kayan: courses,
      operation: { name: 'archiveMany', effect: 'update', updatesMany: true, label: { en: 'Archive', ar: 'أرشفة' }, fields },
      run: async (input: Record<string, unknown>) => (bulkSent.push(input), true),
    } as never))
    const said = dialog()?.textContent ?? ''
    await act(async () => fire(dialog()!.querySelector('form') as unknown as Element, 'submit'))
    const alert = dialog()?.querySelector('[role="alert"]')?.textContent
    await act(async () => mounted?.unmount())
    mounted = undefined
    return { said, alert }
  }
  const boxless = await bulk([])
  assert.deepEqual(bulkSent, [{ where: { id: { in: ['s1'] } } }], 'a bulk update with no box sends its where')
  assert.equal(boxless.said.includes('Only the fields you fill in change.'), false, 'and says nothing about boxes it has none of')
  const boxed = await bulk(courses.fields.filter((one) => one.name === 'fee'))
  assert.deepEqual(bulkSent.length, 0, 'a bulk update with one box sends nothing while it is empty')
  assert.equal(boxed.alert, 'Fill in at least one field.')
})

test('67. the button behind a confirm runs the operation by name with the row\'s id, and the effect it carries decides where the host lands', async () => {
  const calls: { operation: string; input: Record<string, unknown> }[] = []
  const landed: { row: unknown; effect?: string }[] = []
  const host = await render(
    createElement(Form, {
      kayan: courses,
      screen: screenOf(courses.pages.edit!),
      client: {
        create: async () => ({}),
        update: async () => ({}),
        delete: async () => ({}),
        run: async (operation: string, input: Record<string, unknown>) => {
          calls.push({ operation, input })
          return { id: 'a-row', archived: true }
        },
      },
      value: { id: 'a-row', title: 'Tajweed' },
      t,
      locale: 'en',
      onDone: (row: unknown, effect?: string) => landed.push({ row, effect }),
      operations: { archive: true, update: true },
    }),
  )
  await act(async () => click(host.querySelector('[aria-label="More actions"]')!))
  const button = (text: string) => [...window.document.querySelectorAll('button')].find((one) => one.textContent?.trim() === text)!
  assert.ok(button('Archive'), 'the operation this kayan declared a button for is drawn')

  // The confirm is the only control bound to the call, which is the delete's two-click rule.
  await act(async () => {
    click(button('Archive') as unknown as Element)
  })
  assert.equal(calls.length, 0, 'opening the confirm calls nothing')
  const dialog = window.document.querySelector('[data-slot="alert-dialog-content"]')!
  assert.ok(dialog.textContent?.includes('It leaves the catalogue for every student.'), 'the dialog asks the node\'s own confirm, which says what it is about')
  const confirm = [...dialog.querySelectorAll('button')].find((one) => one.textContent?.trim() === 'Archive')!
  await act(async () => {
    click(confirm as unknown as Element)
  })
  assert.deepEqual(
    calls,
    [{ operation: 'archive', input: { id: 'a-row' } }],
    'the confirm runs the operation by its own name, carrying the row\'s id',
  )
  // `archive` is an update list, so the row stays and the host is told which effect ran rather than being sent back to the list.
  assert.equal(landed.length, 1, 'the host is told once')
  assert.equal(landed[0]!.effect, 'update', 'and told the effect, which is what decides where it lands')
  assert.deepEqual(landed[0]!.row, { id: 'a-row', archived: true }, 'beside whatever the operation answered')

  // A save carries its operation's effect: a create sends the host to the row's edit page, an update reads the row again.
  await act(async () => {
    typeInto(host.querySelector('#courses-title') as unknown as Element, 'Tajweed II')
  })
  await act(async () => {
    fire(host.querySelector('form')!, 'submit')
  })
  assert.equal(landed[1]!.effect, 'update', 'a save of a row passes update')
})

test('69. the form tells its host when it is holding an unsaved change and when it has stopped, which is the half of the guard a router does the blocking with', async () => {
  // `beforeunload` misses navigation inside the document, so the form reports `dirty` to the host, which opens the same dialog Cancel opens.
  const reported: boolean[] = []
  const { client, written } = recording()
  const host = await render(
    createElement(Form, {
      kayan: courses,
      client,
      value: { id: 'a-row', title: 'Tajweed' },
      t,
      locale: 'en',
      onDone: () => {},
      onDirty: (dirty: boolean) => reported.push(dirty),
    }),
  )
  assert.deepEqual(reported, [false], 'a form seeded from its row is holding nothing')

  await act(async () => {
    typeInto(host.querySelector('#courses-title') as unknown as Element, 'Tajweed II')
  })
  assert.equal(reported.at(-1), true, 'a value that differs from the seed is reported as a change')

  // Typed back to the seed is not a change however many keystrokes it took: the comparison is against the seed, never the last value.
  await act(async () => {
    typeInto(host.querySelector('#courses-title') as unknown as Element, 'Tajweed')
  })
  assert.equal(reported.at(-1), false, 'and a value typed back to the seed is not one')

  // A save that lands clears it, so the host stops blocking the navigation the save itself makes.
  await act(async () => {
    typeInto(host.querySelector('#courses-title') as unknown as Element, 'Tajweed III')
  })
  assert.equal(reported.at(-1), true, 'the change before the save is reported')
  await act(async () => {
    fire(host.querySelector('form')!, 'submit')
  })
  assert.equal(written.length, 1, 'the form ran one write')
  assert.equal(reported.at(-1), false, 'and what was written is no longer a change the host should block on')

  // A form that goes away holds nothing, so the host's blocker does not outlive the screen.
  await act(async () => {
    mounted!.unmount()
    mounted = undefined
  })
  assert.equal(reported.at(-1), false, 'an unmounted form reports that it is holding nothing')
})

test('70. one dialog asks the discard question, so the form\'s Cancel and a host blocking a navigation cannot word it differently', async () => {
  // One component, two callers: the form opens it from a trigger, a host from its router's blocked navigation.
  const discarded: string[] = []
  const controlled = await render(
    createElement(DiscardDialog, {
      open: true,
      onDiscard: () => discarded.push('host'),
      t,
    }),
  )
  assert.ok(controlled, 'the controlled half mounts with no trigger at all')
  const dialog = () => window.document.querySelector('[data-slot="alert-dialog-content"]')
  assert.ok(dialog()?.textContent?.includes('Discard changes'), 'a host that hands `open` gets the dialog with no click')
  assert.ok(
    dialog()?.textContent?.includes('You have unsaved changes. Leave without saving?'),
    'carrying the same sentence the form\'s own Cancel carries',
  )
  const confirm = [...dialog()!.querySelectorAll('button')].find((one) => one.textContent?.trim() === 'Discard changes')!
  await act(async () => {
    click(confirm as unknown as Element)
  })
  assert.deepEqual(discarded, ['host'], 'and its action is the host\'s own, which is the navigation the router held back')

  // Closed until the first click, so the only control bound to leaving is not in the tree that click lands on.
  const left: string[] = []
  const host = await render(
    createElement(Form, {
      kayan: courses,
      client: { create: async () => ({}), update: async () => ({}), delete: async () => ({}) },
      value: { id: 'a-row', title: 'Tajweed' },
      t,
      locale: 'en',
      onDone: () => {},
      onCancel: () => left.push('cancel'),
    }),
  )
  await act(async () => {
    typeInto(host.querySelector('#courses-title') as unknown as Element, 'Tajweed II')
  })
  const cancel = [...host.querySelectorAll('button')].find((one) => one.textContent?.trim() === 'Cancel')!
  await act(async () => {
    click(cancel as unknown as Element)
  })
  assert.deepEqual(left, [], 'the first click opens the question rather than answering it')
  assert.ok(dialog()?.textContent?.includes('Discard changes'), 'which is the same dialog the host opened')
})

test('71. a refused bulk says so and leaves the rows ticked, so a denied row never reads as one the call changed', async () => {
  await toasted()
  // The runner refuses a bulk on a row the access callbacks narrow away. A refusal that closed the dialog silently would look like a run that landed.
  const calls: string[] = []
  const docs = [{ id: 'c1', title: 'Tajweed' }, { id: 'c2', title: 'Nahw' }]
  const host = await render(withToaster(
    createElement(List, {
      kayan: courses,
      page: pageOf(docs),
      query: {},
      t,
      locale: 'en',
      onQuery: () => {},
      href: (id: string) => `/courses/${id}`,
      newHref: '/courses/new',
      screen: listScreen(),
      operations: { deleteMany: true, updateMany: true },
      run: async (operation: string) => {
        calls.push(operation)
        // What the arm throws for a refusal: a key, never prose.
        throw { data: { key: 'error.forbidden.operation', params: { kayan: 'courses', operation } } }
      },
    })),
  )
  const boxes = () => [...host.querySelectorAll('table [role="checkbox"]')]
  const count = () => host.querySelector('[data-mithaq-selected]')?.getAttribute('data-mithaq-selected')
  await act(async () => {
    click(boxes()[1]! as unknown as Element)
  })
  assert.equal(count(), '1', 'one row is ticked')

  const button = (text: string) => [...host.querySelectorAll('button')].find((one) => one.textContent?.trim() === text)!
  await act(async () => {
    click(button('Delete') as unknown as Element)
  })
  await confirmYes()
  assert.deepEqual(calls, ['deleteMany'], 'the confirm ran the call')
  assert.deepEqual(await toasted(), ['error: Something went wrong, so nothing was saved. Try again.'], 'and the refusal is said in a red toast, rather than swallowed, in the shared words where its key has none')
  assert.equal(count(), '1', 'the ticked row is still ticked, because nothing was written to it, which is also the set a second try would name')

  // The update's dialog stays open on a refusal, so the typed value is still there to correct and the reason is shown inside it.
  await act(async () => {
    click(button('Update') as unknown as Element)
  })
  const dialog = () => window.document.querySelector('[data-slot="alert-dialog-content"]')
  await act(async () => {
    typeInto(dialog()!.querySelector('#courses-updateMany-fee') as unknown as HTMLInputElement, '450')
  })
  await act(async () => {
    fire(dialog()!.querySelector('form') as unknown as Element, 'submit')
  })
  assert.deepEqual(calls, ['deleteMany', 'updateMany'], 'the save ran the second call')
  assert.ok(dialog(), 'and the dialog it was refused in is still open')
  assert.equal((dialog()!.querySelector('#courses-updateMany-fee') as unknown as HTMLInputElement).value, '450', 'still holding what was typed into it')
  assert.equal(dialog()!.querySelector('[role="alert"]')?.textContent, 'error.forbidden.operation', 'with the refusal inside it, not only behind its overlay')
})

test('72. a save hands the host the written row while the host is still holding the change it reported, which is why the route\'s own navigation ignores its blocker', async () => {
  // The reset lands in the form's store, but `onDirty(false)` is an effect of the next render and `onDone` is called before it.
  // A host blocking on the last flag it was handed would block the navigation the save itself makes, so such a host navigates after a save with `ignoreBlocker: true`.
  const reported: boolean[] = []
  const atDone: (boolean | undefined)[] = []
  const { client, written } = recording()
  const host = await render(
    createElement(Form, {
      kayan: courses,
      client,
      value: { id: 'a-row', title: 'Tajweed' },
      t,
      locale: 'en',
      onDone: () => atDone.push(reported.at(-1)),
      onDirty: (dirty: boolean) => reported.push(dirty),
    }),
  )
  await act(async () => {
    typeInto(host.querySelector('#courses-title') as unknown as Element, 'Tajweed II')
  })
  assert.equal(reported.at(-1), true, 'the change is reported before the save')
  await act(async () => {
    fire(host.querySelector('form')!, 'submit')
  })
  assert.equal(written.length, 1, 'the form ran one write')
  assert.deepEqual(atDone, [true], 'and the host was still holding the change when it was told where to go')
  assert.equal(reported.at(-1), false, 'which it stops holding only once the render after the save has run')
})

test('73. the button\'s dialog draws the input the operation declared, sends what was typed into it, and keeps the dialog open over a refusal that names the box', async () => {
  // `courses.archive`'s schema takes a required `reason`, which is an input of the operation and no field of `courses`, so the dialog draws it.
  const calls: { operation: string; input: Record<string, unknown> }[] = []
  const saves: unknown[] = []
  const landed: unknown[] = []
  let refuse = true
  const host = await render(
    createElement(Form, {
      kayan: courses,
      screen: screenOf(courses.pages.edit!),
      client: {
        create: async () => ({}),
        update: async (...given: unknown[]) => {
          saves.push(given)
          return {}
        },
        delete: async () => ({}),
        run: async (operation: string, input: Record<string, unknown>) => {
          calls.push({ operation, input })
          // What the runner answers for a value its schema refused: a key and one issue per path, never prose.
          if (refuse) {
            throw {
              data: {
                key: 'error.invalid.value',
                params: { issues: [{ path: 'reason', message: 'courses.operations.archive.reason.required' }] },
              },
            }
          }
          return { id: 'a-row', archived: true }
        },
      },
      value: { id: 'a-row', title: 'Tajweed' },
      t,
      locale: 'en',
      onDone: (row: unknown) => landed.push(row),
      operations: { archive: true },
    }),
  )
  await act(async () => click(host.querySelector('[aria-label="More actions"]')!))
  const button = (text: string) => [...window.document.querySelectorAll('button')].find((one) => one.textContent?.trim() === text)!
  await act(async () => {
    click(button('Archive') as unknown as Element)
  })
  const dialog = () => window.document.querySelector('[data-slot="alert-dialog-content"]')!
  const box = () => dialog().querySelector('#courses-archive-reason') as unknown as Element
  assert.ok(box(), 'the dialog draws a control for the field the operation declared')
  assert.ok(
    [...dialog().querySelectorAll('label')].some((one) => one.textContent?.trim() === 'Reason'),
    'under the label that field declared, which is the operation\'s own copy key and not the kayan\'s',
  )
  assert.equal(calls.length, 0, 'opening the dialog calls nothing')

  const confirm = () => [...dialog().querySelectorAll('button')].find((one) => one.textContent?.trim() === 'Archive')!
  await act(async () => {
    click(confirm() as unknown as Element)
  })
  assert.deepEqual(calls, [{ operation: 'archive', input: { id: 'a-row' } }], 'a box nothing touched is left out of the call')
  assert.equal(landed.length, 0, 'a refused operation tells the host nothing')
  assert.ok(dialog(), 'the dialog is still open, so the box that was refused is still there to correct')
  assert.ok(
    dialog().textContent?.includes('courses.operations.archive.reason.required'),
    'and the refusal is drawn against the box it named, as the key the schema wrote, which this steps\' translator answers with its fallback',
  )

  refuse = false
  await act(async () => {
    typeInto(box(), 'duplicate entry')
  })
  await act(async () => {
    click(confirm() as unknown as Element)
  })
  assert.deepEqual(
    calls[1],
    { operation: 'archive', input: { id: 'a-row', reason: 'duplicate entry' } },
    'the call carries the row\'s id and what was typed into the box',
  )
  assert.deepEqual(landed, [{ id: 'a-row', archived: true }], 'the host is told once, and only once it landed')
  // One click runs the operation and nothing else: the dialog's form sits inside the screen's form in the React tree, and a submit that travelled there would save the row too. Measured as the form's writes, not its runs.
  assert.equal(calls.length, 2, 'the two clicks ran the operation twice')
  assert.deepEqual(saves, [], 'and no save went with either of them')

  // A reopened dialog starts empty: the last run's values are dropped on close, so nobody archives a second row under the first one's reason.
  await act(async () => {
    click(button('Archive') as unknown as Element)
  })
  assert.equal((box() as unknown as { value: string }).value, '', 'a reopened dialog draws an empty box')
})

test('73a. the dialog draws its refusal in the viewer\'s own language, because the operation\'s schema names its own copy keys', async () => {
  // That schema is the project's own, written against zod directly, so an Arabic reader gets zod's English unless it names a key, and it names two. Here is the Arabic one, under its box.
  const arabic: Record<string, string> = {
    'courses.operations.archive.reason.required': 'سبب الأرشفة مطلوب.',
  }
  const ar = (key: string, fallback?: string) => arabic[key] ?? fallback
  const host = await render(
    createElement(Form, {
      kayan: courses,
      screen: screenOf(courses.pages.edit!),
      client: {
        create: async () => ({}),
        update: async () => ({}),
        delete: async () => ({}),
        run: async () => {
          throw {
            data: {
              key: 'error.invalid.value',
              params: { issues: [{ path: 'reason', message: 'courses.operations.archive.reason.required' }] },
            },
          }
        },
      },
      value: { id: 'a-row', title: 'Tajweed' },
      t: ar,
      locale: 'ar',
      onDone: () => {},
      operations: { archive: true },
    }),
  )
  // The button reads in the locale asked for, the label the declaration wrote, not anything this translator answers.
  await act(async () => click(host.querySelector('[aria-label="More actions"]')!))
  const named = (text: string) => [...window.document.querySelectorAll('button')].find((one) => one.textContent?.trim() === text)!
  await act(async () => {
    click(named('أرشفة') as unknown as Element)
  })
  const dialog = () => window.document.querySelector('[data-slot="alert-dialog-content"]')!
  const confirm = () => [...dialog().querySelectorAll('button')].find((one) => one.textContent?.trim() === 'أرشفة')!
  await act(async () => {
    click(confirm() as unknown as Element)
  })
  assert.ok(dialog(), 'the dialog stayed open over the refusal')
  assert.ok(dialog().textContent?.includes('سبب الأرشفة مطلوب.'), 'and the box reads the project\'s Arabic sentence')
  assert.ok(
    !dialog().textContent?.includes('courses.operations.archive.reason.required'),
    'so the key the wire carried is not what a person reads',
  )
})

const panelled = (() => {
  const page = structuredClone(courses.pages.edit!) as PageClient
  const formOf = (value: unknown): unknown[] | undefined => {
    if (Array.isArray(value)) return value.map(formOf).find(Boolean)
    if (!value || typeof value !== 'object') return undefined
    const node = value as Record<string, unknown>
    return Array.isArray(node.form) ? node.form : Object.values(node).map(formOf).find(Boolean)
  }
  formOf(page)!.push({ component: activity })
  return page
})()

test('74. a component node inside a form draws the component its page names, with no field behind it and no control around it, reading the form\'s values through useForm()', async () => {
  // A page writes `{ component: dashboardUi('file.tsx#Export') }`; the host hands the form the component that reference names, which is the one entry below.
  const handed: { props: ComponentProps; form: ReturnType<typeof useForm>; kayan: string }[] = []
  const Activity = (props: ComponentProps) => {
    handed.push({ props, form: useForm(), kayan: useKayan().name })
    return createElement('section', { 'data-activity': true }, `activity for ${String(useRecord()?.id ?? 'nothing')}`)
  }
  try {
    const host = await render(
      createElement(Form, {
        kayan: courses,
        screen: screenOf(panelled, courses, { [activity]: Activity }),
        client: { create: async () => ({}), update: async () => ({}), delete: async () => ({}) },
        value: { id: 'a-row', title: 'Tajweed' },
        t,
        locale: 'en',
        onDone: () => {},
      }),
      { record: { id: 'a-row', title: 'Tajweed' } },
    )
    const drawn = host.querySelector('[data-activity]')
    assert.ok(drawn, 'the node drew the component the page named')
    assert.equal(drawn.textContent, 'activity for a-row', 'and handed it the row the form is editing')
    assert.equal(handed.length, 1, 'once, because the node is one node of the tree')
    const { props, form, kayan } = handed[0]!
    // A component is handed `ComponentProps`, the page alone, and reads the rest through hooks; it has no field, value or change to report.
    assert.deepEqual(Object.keys(props), ['page'], 'handed its page and nothing else')
    assert.equal(kayan, 'courses')
    assert.equal(form.getData().title, 'Tajweed', 'the values the form holds')
    assert.equal(typeof form.setValue, 'function', 'and the one way to change them')
    assert.equal(form.disabled, false, 'writable while the form is not busy')
    for (const absent of ['field', 'onChange', 'value']) {
      assert.equal(absent in props, false, `a component is handed no ${absent}, because it edits nothing`)
    }
    // No field shell is around it: a component has no label to point at and no refusal to carry.
    assert.equal(drawn.closest('[data-slot="field"]'), null, 'and no field shell around it')
  } finally {
    await act(async () => mounted?.unmount())
    mounted = undefined
  }
})

const withPanel = (Panel: (props: ComponentProps) => ReactElement) => screenOf(panelled, courses, { [activity]: Panel })

test('a panel reads a sibling value and changes another field through the form', async () => {
  const Panel = (_: ComponentProps) => {
    const { getData, setValue } = useForm()
    return createElement('button', { type: 'button', 'data-panel-set': true, onClick: () => setValue('summary', `${getData().title} summary`) }, 'Set summary')
  }
  try {
    const host = await render(createElement(Form, {
      kayan: courses,
      screen: withPanel(Panel),
      client: { create: async () => ({}), update: async () => ({}), delete: async () => ({}) },
      value: { id: 'a-row', title: 'Tajweed', summary: 'Old' },
      t, locale: 'en', onDone: () => {},
    }))
    await act(async () => click(host.querySelector('[data-panel-set]') as Element))
    assert.equal((host.querySelector('#courses-summary') as HTMLInputElement).value, 'Tajweed summary')
  } finally {
    await act(async () => mounted?.unmount())
    mounted = undefined
  }
})

test('a field a panel sets is saved though its page does not name it', async () => {
  // The page names title and the panel, not level, so level is saved only because the panel set it: a field changed by something on the page is a field the page wrote.
  const Panel = (_: ComponentProps) => {
    const { setValue } = useForm()
    return createElement('button', { type: 'button', 'data-panel-fee': true, onClick: () => setValue('level', 5) }, 'Set level')
  }
  const page: PageClient = recordPage([{ form: [{ field: 'title' }, { component: activity }] }], '/courses/:id')
  const written: Record<string, unknown>[] = []
  try {
    const host = await render(createElement(Form, {
      kayan: courses,
      screen: screenOf(page, courses, { [activity]: Panel }),
      client: { create: async () => ({}), update: async (input: Record<string, unknown>) => (written.push(input), {}), delete: async () => ({}) },
      value: { id: 'a-row', title: 'Tajweed', summary: 'Old', fee: 300, level: 3 },
      t, locale: 'en', onDone: () => {},
    }))
    await act(async () => click(host.querySelector('[data-panel-fee]') as Element))
    await act(async () => fire(host.querySelector('form')!, 'submit'))
    assert.deepEqual(written[0], { id: 'a-row', level: 5 }, 'the one field the panel set, and not the named title nobody changed')
  } finally {
    await act(async () => mounted?.unmount())
    mounted = undefined
  }
})

test('a panel cannot change a field the form marks read-only', async () => {
  const Panel = (_: ComponentProps) => {
    const { setValue } = useForm()
    return createElement('button', { type: 'button', 'data-panel-denied': true, onClick: () => setValue('title', 'Changed') }, 'Change title')
  }
  try {
    const host = await render(createElement(Form, {
      kayan: courses,
      screen: withPanel(Panel),
      client: { create: async () => ({}), update: async () => ({}), delete: async () => ({}) },
      value: { id: 'a-row', title: 'Tajweed' }, writes: (name: string) => name !== 'title',
      t, locale: 'en', onDone: () => {},
    }))
    await act(async () => click(host.querySelector('[data-panel-denied]') as Element))
    assert.equal((host.querySelector('#courses-title') as HTMLInputElement).value, 'Tajweed')
  } finally {
    await act(async () => mounted?.unmount())
    mounted = undefined
  }
})

test('an accordion opens one item at a time', async () => {
  const page: PageClient = recordPage([{ form: [{ accordion: [
    { item: 'first', label: { en: 'First' }, fields: [{ field: 'title' }] },
    { item: 'second', label: { en: 'Second' }, fields: [{ field: 'summary' }] },
  ] }] }], '/courses/:id')
  const host = await render(createElement(Form, {
    kayan: courses,
    screen: screenOf(page),
    client: { create: async () => ({}), update: async () => ({}), delete: async () => ({}) },
    value: { id: 'a-row', title: 'Tajweed', summary: 'Notes' }, t, locale: 'en', onDone: () => {},
  }))
  const triggers = [...host.querySelectorAll('[data-layout-accordion="true"] button')]
  assert.equal(triggers.length, 2)
  assert.equal(triggers[0]!.getAttribute('aria-expanded'), 'true')
  assert.equal(triggers[1]!.getAttribute('aria-expanded'), 'false')
  await act(async () => click(triggers[1] as Element))
  assert.equal(triggers[0]!.getAttribute('aria-expanded'), 'false')
  assert.equal(triggers[1]!.getAttribute('aria-expanded'), 'true')
})

test('75. a component the host has no component for says so rather than drawing a blank', async () => {
  // A reference the build accepted but the host handed no component for reads as an empty place unless it is said.
  const host = await render(
    createElement(Form, {
      kayan: courses,
      screen: screenOf(panelled),
      client: { create: async () => ({}), update: async () => ({}), delete: async () => ({}) },
      value: { id: 'a-row', title: 'Tajweed' },
      t,
      locale: 'en',
      onDone: () => {},
    }),
  )
  const said = host.querySelector(`[data-missing-component="${activity}"]`)
  assert.ok(said, 'the component with no component registered is named rather than drawn as nothing')
  assert.ok(said.textContent?.includes('No component is registered for'), 'in a sentence whoever is copying the registry can act on')
  assert.ok(said.textContent?.includes(activity), 'and the sentence names which one')
  // Not a live region: alerts here are refusals a person has to be told about.
  assert.equal(said.getAttribute('role'), null, 'and announced nowhere, because it is not a refusal')
})

test('78. a page\'s button is drawn where its node sits, and the form draws its panels again once the operation returns', async () => {
  // A project's explicit danger region remains available beside the new header actions.
  const danger = (courses.pages.edit as Extract<PageClient, { page: unknown }>).page.more!
  assert.ok(Array.isArray(danger))
  const host = await render(
    createElement(Form, {
      kayan: courses,
      screen: screenOf(plus(recordPage([{ form: ['title'] }]), 'danger', ...danger)),
      client: {
        create: async () => ({}),
        update: async () => ({}),
        delete: async () => ({}),
        run: async () => ({ id: 'a-row', archived: true }),
      },
      value: { id: 'a-row', title: 'Tajweed' },
      t,
      locale: 'en',
      onDone: () => {},
      operations: { archive: true },
    }),
  )
  const archive = [...host.querySelectorAll('button')].find((one) => one.textContent?.trim() === 'Archive')!
  const save = [...host.querySelectorAll('button')].find((one) => one.textContent?.trim() === 'Save')!
  const zone = host.querySelector('[data-region="danger"]')!
  assert.ok(zone?.textContent?.startsWith('Danger zone'), 'the layout fences the region the button sits in')
  assert.ok(zone.contains(archive), 'and the button is inside it')
  assert.equal(zone.contains(save), false, 'while Save is not, because the two are not the same kind of button')

  const placed: ClientKayan = {
    ...courses,
    operations: [...courses.operations, { name: 'publish', effect: 'update' }, { name: 'recount', effect: 'update' }],
  }

  const page = plus(
    recordPage([{ form: ['title', { button: 'recount', label: { en: 'Recount', ar: 'إعادة العد' } }] }, { button: 'publish', label: { en: 'Publish', ar: 'نشر' } }]),
    'danger',
    ...danger,
  )
  const three = await render(
    createElement(Form, {
      kayan: placed,
      screen: screenOf(page, placed),
      client: {
        create: async () => ({}),
        update: async () => ({}),
        delete: async () => ({}),
        run: async () => ({ id: 'a-row' }),
      },
      value: { id: 'a-row', title: 'Tajweed' },
      t,
      locale: 'en',
      onDone: () => {},
      operations: { archive: true, publish: true, recount: true },
    }),
  )
  const named = (text: string) => [...three.querySelectorAll('button')].find((one) => one.textContent?.trim() === text)!
  const formNode = three.querySelector('[data-node="form"]')!
  const fenced = three.querySelector('[data-region="danger"]')!
  assert.ok(formNode.contains(named('Recount')), 'a button inside the form node is drawn inside the form')
  assert.equal(formNode.contains(named('Publish')), false, 'and one beside the form node is drawn beside it')
  assert.ok(three.querySelector('[data-region="main"]')!.contains(named('Publish')), 'in the region that holds it')
  assert.equal(fenced.contains(named('Publish')) || fenced.contains(named('Recount')), false, 'while neither is in the fenced card')
  assert.ok(fenced.contains(named('Archive')), 'which holds the one that sits there')

  // The reload the form does after one of these operations returns, counted on the panel leaf, which remounts with every other leaf; a join leaf reads its child again on the same bump.
  let drawnPanels = 0
  const Panel = () => {
    drawnPanels += 1
    return createElement('section', null, 'activity')
  }
  const reloading = await render(
    createElement(Form, {
      kayan: courses,
      screen: withPanel(Panel),
      client: {
        create: async () => ({}),
        update: async () => ({}),
        delete: async () => ({}),
        run: async () => ({ id: 'a-row', archived: true }),
      },
      value: { id: 'a-row', title: 'Tajweed' },
      t,
      locale: 'en',
      onDone: () => {},
      operations: { archive: true },
    }),
  )
  await act(async () => click(reloading.querySelector('[aria-label="More actions"]')!))
  const before = drawnPanels
  const dialog = () => window.document.querySelector('[data-slot="alert-dialog-content"]')!
  await act(async () => {
    click([...window.document.querySelectorAll('button')].find((one) => one.textContent?.trim() === 'Archive')! as unknown as Element)
  })
  await act(async () => {
    typeInto(dialog().querySelector('#courses-archive-reason') as unknown as Element, 'done with it')
  })
  await act(async () => {
    click([...dialog().querySelectorAll('button')].find((one) => one.textContent?.trim() === 'Archive')! as unknown as Element)
  })
  assert.ok(drawnPanels > before, 'the leaves are drawn again once the operation returned, which is the reload')
})

test('79. the form marks a box touched when the person leaves it and shows nothing until something is wrong, while a refusal the server sent is under its box whether or not that box was ever left', async () => {
  // Read from a component the project registered through `useKayanField`: the only way to read the two halves separately, since the shell draws a message and never a "touched".
  // A box is told it is wrong once a person has left it, so nothing is red while they are still typing the first letter.
  const { Form: Bound } = await import('../registry/form.tsx')
  const { useKayanField } = await import('../registry/form-context.tsx')
  const Probe = () => {
    const bound = useKayanField('title')
    return createElement('span', { 'data-touched': String(bound.touched), 'data-error': bound.error ?? '' })
  }
  const refusal = { data: { key: 'error.invalid.value', params: { issues: [{ path: 'title', message: 'A course needs a title.' }] } } }
  const client = { create: async () => ({}), update: async () => ({}), delete: async () => ({}) }
  const probe = (host: HTMLElement) => host.querySelector('[data-touched]')!
  try {
    const host = await render(
      createElement(Bound, {
        kayan: courses,
        screen: withPanel(Probe),
        client,
        value: { id: 'a-row', title: 'Tajweed' },
        t,
        locale: 'en',
        onDone: () => {},
      }),
    )
    assert.equal(probe(host).getAttribute('data-touched'), 'false', 'a box nobody has been in is untouched')
    assert.equal(probe(host).getAttribute('data-error'), '', 'and says nothing, because nothing has refused it')

    // The blur as the browser raises it, `focusout`, which bubbles: that is why the shell carries one handler rather than every control.
    await act(async () => {
      fire(host.querySelector('#courses-title')!, 'focusout')
    })
    assert.equal(probe(host).getAttribute('data-touched'), 'true', 'leaving the box marks it touched')
    assert.equal(
      probe(host).getAttribute('data-error'),
      '',
      'and it still says nothing, because the title it holds breaks no rule the projection carries',
    )

    // The server's 400, keyed per field, reaches the box through `form.setErrorMap` and is drawn without any blur: a refusal answers a save, and a save leaves every box at once.
    const refused = await render(
      createElement(Bound, {
        kayan: courses,
        screen: withPanel(Probe),
        client,
        error: refusal,
        value: { id: 'a-row', title: 'Tajweed' },
        t,
        locale: 'en',
        onDone: () => {},
      }),
    )
    assert.equal(probe(refused).getAttribute('data-touched'), 'true', 'a box the server refused reads as one the person has left')
    assert.equal(
      probe(refused).getAttribute('data-error'),
      'A course needs a title.',
      'and the seam answers the sentence the wire sent, which is the one the shell draws under the box',
    )
    // TanStack's own error map holds it, not a second record beside it that could disagree.
    const alert = refused.querySelector('#courses-title-error')
    assert.equal(alert?.textContent, 'A course needs a title.', 'the box below the control says the same sentence')
  } finally {
    await act(async () => mounted?.unmount())
    mounted = undefined
  }
})

const coursesCopy = copyFile(JSON.parse(readFileSync(new URL('../../../templates/asas/src/messages/courses.json', import.meta.url), 'utf8'))) as Record<string, { en?: string }>
const said = (key: string, fallback?: string) => (key.startsWith('courses.') ? coursesCopy[key.slice('courses.'.length)]?.en : undefined) ?? fallback

test('80. a rule the projection carries refuses a value before any request, in the sentence the server would send for it', async () => {
  const { client, written } = recording()
  const host = await render(
    createElement(Form, {
      kayan: courses,
      screen: screenOf(recordPage([{ form: [{ field: 'title' }, { field: 'summary' }] }], '/courses/new')),
      client,
      value: null,
      t: said,
      locale: 'en',
      onDone: () => {},
    }),
  )
  const errorOf = (name: string) => host.querySelector(`#courses-${name}-error`)?.textContent
  // Something other than the title, so Save is offered and the title is left empty.
  await act(async () => typeInto(host.querySelector('#courses-summary')!, 'Moved'))
  await act(async () => fire(host.querySelector('form')!, 'submit'))
  assert.equal(written.length, 0, 'an empty required field sends nothing')
  assert.equal(errorOf('title'), 'This field is required.', 'and its box says the sentence the server seeds for `courses.title.required`')

  await act(async () => typeInto(host.querySelector('#courses-title')!, 'Tajweed'))
  await act(async () => typeInto(host.querySelector('#courses-summary')!, 'x'.repeat(201)))
  await act(async () => fire(host.querySelector('form')!, 'submit'))
  assert.equal(written.length, 0, 'a value longer than maxLength sends nothing either')
  assert.equal(errorOf('summary'), 'The value is too long.', 'and says `courses.summary.maxLength`')
  assert.equal(errorOf('title'), undefined, 'while the title, now filled, says nothing')

  await act(async () => typeInto(host.querySelector('#courses-summary')!, 'Moved'))
  await act(async () => fire(host.querySelector('form')!, 'submit'))
  assert.deepEqual(written, [{ title: 'Tajweed', summary: 'Moved' }], 'a value every rule holds is sent, once')
})

test('215e. Save on a fresh create form is offered before anything is typed, and pressing it says which required box is empty and sends nothing', async () => {
  const { client, written } = recording()
  const host = await render(
    createElement(Form, {
      kayan: courses,
      screen: screenOf(recordPage([{ form: [{ field: 'title' }, { field: 'summary' }] }], '/courses/new')),
      client,
      value: null,
      t: said,
      locale: 'en',
      onDone: () => {},
    }),
  )
  const save = host.querySelector('button[type="submit"]') as HTMLButtonElement
  assert.equal(save.disabled, false, 'Save is offered on a pristine create form')
  await act(async () => click(save))
  assert.equal(written.length, 0, 'pressing it sends nothing while a required box is empty')
  assert.equal(host.querySelector('#courses-title-error')?.textContent, 'This field is required.', 'and the empty box says so')
})

test('215f. an update to a kayan whose update takes expectedUpdatedAt sends the instant the row was read at, and after a save the instant that save answered with', async () => {
  const written: Record<string, unknown>[] = []
  const client = {
    create: async () => ({}),
    update: async (input: Record<string, unknown>) => {
      written.push(input)
      return { ...input, updatedAt: `2026-10-08T10:00:0${written.length}.000Z` }
    },
    delete: async () => ({}),
  }
  const draw = (expectedUpdatedAt?: boolean) => render(createElement(Form, {
    kayan: courses,
    client,
    value: { id: 'a-row', title: 'Tajweed', updatedAt: '2026-10-08T09:00:00.000Z' },
    t,
    locale: 'en',
    onDone: () => {},
    expectedUpdatedAt,
  }))
  let host = await draw(true)
  const saveAs = async (title: string) => {
    await act(async () => typeInto(host.querySelector('#courses-title')!, title))
    await act(async () => fire(host.querySelector('form')!, 'submit'))
  }
  await saveAs('Tajweed II')
  await saveAs('Tajweed III')
  assert.deepEqual(written.map((one) => one.expectedUpdatedAt), ['2026-10-08T09:00:00.000Z', '2026-10-08T10:00:01.000Z'], 'the read instant, then the one the first save answered with')
  await act(async () => mounted?.unmount())
  mounted = undefined
  written.length = 0
  host = await draw()
  await saveAs('Tajweed IV')
  assert.equal('expectedUpdatedAt' in written[0]!, false, 'a kayan whose update does not take it is sent none')
})

test('80b. a box is checked when the person leaves it, in the sentence the server would send, and the sentence goes the moment the value holds', async () => {
  const { client, written } = recording()
  const host = await render(
    createElement(Form, {
      kayan: courses,
      screen: screenOf(recordPage([{ form: [{ field: 'title' }, { field: 'summary' }] }], '/courses/new')),
      client,
      value: null,
      t: said,
      locale: 'en',
      onDone: () => {},
    }),
  )
  const errorOf = (name: string) => host.querySelector(`#courses-${name}-error`)?.textContent
  assert.equal(errorOf('title'), undefined, 'a box nobody has been in says nothing')

  await act(async () => fire(host.querySelector('#courses-title')!, 'focusout'))
  assert.equal(errorOf('title'), 'This field is required.', 'a required box left empty says the server\'s sentence under it')
  assert.equal(errorOf('summary'), undefined, 'and the box nobody entered says nothing')

  // Typed into and not yet left: the sentence goes at once, because the value holds.
  await act(async () => typeInto(host.querySelector('#courses-title')!, 'Tajweed'))
  assert.equal(errorOf('title'), undefined, 'filling the box clears its sentence without a second blur')

  // Too long while typing says nothing until the box is left.
  await act(async () => typeInto(host.querySelector('#courses-summary')!, 'x'.repeat(201)))
  assert.equal(errorOf('summary'), undefined, 'a box still being typed into is not told it is wrong')
  await act(async () => fire(host.querySelector('#courses-summary')!, 'focusout'))
  assert.equal(errorOf('summary'), 'The value is too long.', 'and leaving it says `courses.summary.maxLength`')
  assert.equal(written.length, 0, 'none of it sent anything')
})

test('80c. a refusal a save drew goes from under its box the moment the value holds', async () => {
  const { client } = recording()
  const host = await render(
    createElement(Form, {
      kayan: courses,
      screen: screenOf(recordPage([{ form: [{ field: 'title' }, { field: 'summary' }] }], '/courses/new')),
      client,
      value: null,
      t: said,
      locale: 'en',
      onDone: () => {},
    }),
  )
  const errorOf = (name: string) => host.querySelector(`#courses-${name}-error`)?.textContent
  await act(async () => typeInto(host.querySelector('#courses-summary')!, 'Moved'))
  await act(async () => fire(host.querySelector('form')!, 'submit'))
  assert.equal(errorOf('title'), 'This field is required.', 'the save refused the empty title under its box')
  await act(async () => typeInto(host.querySelector('#courses-title')!, 'Tajweed'))
  assert.equal(errorOf('title'), undefined, 'and typing a title clears it before any second save')
})

test('81. two people edit different fields of one course, and both changes survive, because an update sends only what changed', async () => {
  // The server's own update writes the keys it is sent and leaves the rest of the row as it was.
  const row: Record<string, unknown> = { id: 'a-row', title: 'Tajweed', summary: 'None' }
  const sent: Record<string, unknown>[] = []
  const update = async (input: Record<string, unknown>) => {
    sent.push(input)
    Object.assign(row, input)
    return { ...row }
  }
  const client = { create: async () => ({}), update, delete: async () => ({}) }
  const opened = { ...row }
  const edit = async (name: string, text: string) => {
    const host = await render(createElement(Form, { kayan: courses, client, value: opened, t, locale: 'en', onDone: () => {} }))
    await act(async () => typeInto(host.querySelector(`#courses-${name}`)!, text))
    await act(async () => fire(host.querySelector('form')!, 'submit'))
  }
  // Both opened the row before either saved.
  await edit('title', 'Tajweed II')
  await edit('summary', 'Replaced')
  assert.deepEqual(sent, [{ id: 'a-row', title: 'Tajweed II' }, { id: 'a-row', summary: 'Replaced' }], 'each save names the one field its person changed')
  assert.deepEqual(row, { id: 'a-row', title: 'Tajweed II', summary: 'Replaced' }, 'so the second save leaves the first one\'s title in place')
})

test('82. a leaf its when hides, and nobody changed, is not in an update', async () => {
  const { client, written } = recording()
  const page = recordPage([{ form: [{ field: 'title' }, { field: 'delivery' }, { field: 'accessCode', when: { delivery: { equals: 'live' } } }] }])
  const host = await render(
    createElement(Form, {
      kayan: projectedCourses,
      screen: screenOf(page, projectedCourses),
      client,
      value: { id: 'a-row', title: 'Tajweed', delivery: 'recorded', accessCode: 'OLD123' },
      t,
      locale: 'en',
      onDone: () => {},
    }),
  )
  assert.equal(host.querySelector('#courses-accessCode'), null, 'the access code is hidden over a recorded course')
  await act(async () => typeInto(host.querySelector('#courses-title')!, 'Tajweed II'))
  await act(async () => fire(host.querySelector('form')!, 'submit'))
  assert.deepEqual(written, [{ id: 'a-row', title: 'Tajweed II' }], 'the update names the title alone, and not the hidden value it still holds')
})

const stubbed = async (step: (calls: string[], assigned: string[]) => Promise<void>) => {
  const calls: string[] = []
  const assigned: string[] = []
  const fetched = globalThis.fetch
  const assign = window.location.assign
  const replace = window.location.replace
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`)
    const body = url.endsWith('organization/list') ? [{ id: 'o1', name: 'Acme School' }] : url.endsWith('get-session') ? { session: { activeOrganizationId: 'o1' } } : {}
    return new Response(JSON.stringify(body), { status: 200 })
  }) as typeof fetch
  Object.defineProperty(window.location, 'assign', { configurable: true, value: (to: string) => void assigned.push(to) })
  Object.defineProperty(window.location, 'replace', { configurable: true, value: (to: string) => void assigned.push(`replace ${to}`) })
  try {
    await step(calls, assigned)
  } finally {
    globalThis.fetch = fetched
    Object.defineProperty(window.location, 'assign', { configurable: true, value: assign })
    Object.defineProperty(window.location, 'replace', { configurable: true, value: replace })
  }
}

test('the app shell names the organization in the reader\'s language, and in its one name where it has none in that language', async () => {
  const user = { name: 'Admin', email: 'admin@example.com', organizations: [{ id: 'o1', name: 'Acme School', names: JSON.stringify({ en: 'Acme School', ar: 'مدرسة أكمي' }) }], activeOrganizationId: 'o1' }
  const header = async (locale: string, over = user) => (await render(createElement(AppShell, { regions: { primary: null, more: null, header: null, main: null } }), { kayan: undefined, locale, user: over })).querySelector('[data-slot="sidebar-header"]')!.textContent!
  assert.match(await header('ar'), /مدرسة أكمي/, 'in Arabic')
  assert.match(await header('en'), /Acme School/, 'in English')
  assert.match(await header('ar', { ...user, organizations: [{ id: 'o1', name: 'Acme School', names: JSON.stringify({ en: 'Acme School' }) }] }), /Acme School/, 'and in its one name where it has no Arabic one')
})

test('the app shell lists the dashboard and every nav entry in the sidebar, names the active organization, and its user menu offers each locale and signs out', async () => {
  await stubbed(async (calls, assigned) => {
    const host = await render(createElement(AppShell, { regions: { primary: null, more: null, header: createElement('h1', null, 'Courses'), main: createElement('p', null, 'rows') } }), { kayan: undefined, user: { name: 'Admin', email: 'admin@example.com', organizations: [{ id: 'o1', name: 'Acme School' }], activeOrganizationId: 'o1' } })
    await act(async () => sleep(0))
    const hrefs = [...host.querySelectorAll('[data-slot="sidebar"] nav[aria-label="Navigation"] [data-slot="sidebar-content"] a')].map((one) => one.getAttribute('href'))
    assert.deepEqual(hrefs, ['/dashboard', ...screen.nav.map((one) => `/dashboard${one.path}`)], 'the home entry, then the permission-pruned and ordered screen navigation')
    assert.equal(host.querySelector('[data-slot="sidebar"][data-side]')?.getAttribute('data-side'), 'left', 'on the left in a left-to-right document')
    assert.match(host.querySelector('[data-slot="sidebar-header"]')!.textContent!, /Acme School/, 'the switcher names the organization the session holds active')
    assert.match(host.querySelector('[data-region="header"]')!.textContent!, /Courses/, 'the page title sits in the site header')

    await act(async () => click(host.querySelector('[data-slot="sidebar-footer"] [data-slot="dropdown-menu-trigger"]')!))
    const items = [...window.document.querySelectorAll('[role="menuitem"]')].map((one) => one.textContent)
    for (const label of ['English', 'العربية', 'Sign out']) assert.ok(items.includes(label), `the user menu offers ${label}: ${items.join(', ')}`)
    const signOut = [...window.document.querySelectorAll('[role="menuitem"]')].find((one) => one.textContent === 'Sign out')!
    await act(async () => click(signOut as unknown as Element))
    await act(async () => sleep(0))
    assert.ok(calls.includes('POST /api/auth/user/sign-out'), `sign-out posts to the provider: ${calls.join(', ')}`)
    assert.deepEqual(assigned, ['replace /auth/sign-in'], 'and lands on sign-in in place of the page, so Back does not return to it')

    const rtl = await render(createElement(AppShell, { regions: { primary: null, more: null, header: null, main: null } }), { kayan: undefined, dir: 'rtl' })
    assert.equal(rtl.querySelector('[data-slot="sidebar"][data-side]')?.getAttribute('data-side'), 'right', 'and on the right in a right-to-left one')
  })
})

test('the site header\'s trigger stays in view over a page wider than the phone, and brings a hidden sidebar back on a desktop and as a sheet on a phone', async () => {
  await stubbed(async () => {
    // A page wider than any phone, as the courses list is at 375 px: the document scrolled sideways under it and took the header and trigger off the screen in a right-to-left document.
    const wide = createElement('div', { style: { width: '2000px' } }, 'rows')
    const host = await render(createElement(AppShell, { regions: { primary: null, more: null, header: createElement('h1', null, 'Courses'), main: wide } }), { kayan: undefined, dir: 'rtl' })
    await act(async () => sleep(0))
    const header = host.querySelector('[data-region="header"]')!
    const trigger = header.querySelector('[data-sidebar="trigger"]')!
    assert.ok(trigger, 'the trigger sits in the site header')
    assert.ok(!host.querySelector('[data-slot="sidebar"]')!.contains(trigger), 'and not in the sidebar it hides')
    // happy-dom lays nothing out, so the two facts that keep the trigger on screen are read off classes: the inset may shrink below its widest content, and the header holds the top while the page scrolls under it. A wide table scrolls in its own frame.
    assert.ok(host.querySelector('[data-slot="sidebar-inset"]')!.className.split(' ').includes('min-w-0'), 'the inset never takes the width of what it holds')
    assert.ok(!host.querySelector('[data-region="main"]')!.parentElement!.className.includes('overflow-x'), 'and the page itself never scrolls sideways')
    assert.match(header.className, /\bsticky\b/, 'and the header stays at the top while the page scrolls')

    const sidebar = () => host.querySelector('[data-slot="sidebar"][data-state]')!.getAttribute('data-state')
    assert.equal(sidebar(), 'expanded', 'a desktop opens with the sidebar shown')
    await act(async () => click(trigger))
    assert.equal(sidebar(), 'collapsed', 'the trigger hides it')
    await act(async () => click(host.querySelector('[data-region="header"] [data-sidebar="trigger"]')!))
    assert.equal(sidebar(), 'expanded', 'and the same trigger brings it back')

    const width = window.innerWidth
    window.happyDOM.setViewport({ width: 375 })
    try {
      const phone = await render(createElement(AppShell, { regions: { primary: null, more: null, header: null, main: wide } }), { kayan: undefined })
      await act(async () => sleep(0))
      assert.equal(window.document.querySelector('[data-mobile="true"]'), null, 'a phone draws no sheet until asked')
      await act(async () => click(phone.querySelector('[data-region="header"] [data-sidebar="trigger"]')!))
      await act(async () => sleep(0))
      assert.ok(window.document.querySelector('[data-mobile="true"][data-slot="sidebar"]'), 'the trigger opens the sidebar as a sheet on a phone')
    } finally {
      window.happyDOM.setViewport({ width })
    }
  })
})

test('276c. the sidebar on a phone is titled and described in the viewer\'s language and holds no English close, and the record sheet is the phone\'s whole width', async () => {
  const { AppShell } = await import('../../../templates/mithaq/src/ui/app-shell.tsx')
  const { translator } = await import('../../../apps/asas-tanstack/src/copy.ts')
  const width = window.innerWidth
  window.happyDOM.setViewport({ width: 375 })
  try {
    for (const [locale, dir, title, about] of [['en', 'ltr', 'Navigation', 'The pages you can open.'], ['ar', 'rtl', 'التنقل', 'الصفحات التي يمكنك فتحها.']] as const) {
      const phone = await render(createElement(AppShell, { regions: { primary: null, more: null, header: null, main: 'x' } }), { kayan: undefined, locale, dir, t: translator(locale), screen: { ...screen, nav: [{ path: '/tags', page: 'list', kayan: 'tags', icon: 'book-open' }] } })
      await act(async () => sleep(0))
      await act(async () => click(phone.querySelector('[data-region="header"] [data-sidebar="trigger"]')!))
      await act(async () => sleep(0))
      const popup = window.document.querySelector('[data-mobile="true"][data-slot="sidebar"]')!
      assert.ok(popup.querySelector('a[href="/dashboard/tags"] svg.lucide-book-open'), 'the phone sheet draws the declared icon instead of the tags path icon')
      const titled = popup.getAttribute('aria-labelledby')
      assert.equal(window.document.getElementById(titled ?? '')?.textContent, title, `${locale}: the sheet is named in the page's language`)
      assert.equal(popup.getAttribute('aria-describedby') !== null && window.document.getElementById(popup.getAttribute('aria-describedby')!)?.textContent === about, true, `${locale}: and described in it`)
      assert.equal(/Sidebar|Displays|Close/.test(popup.textContent ?? ''), false, `${locale}: no English word of the primitive is left in it`)
    }
  } finally {
    window.happyDOM.setViewport({ width })
  }
  const { RecordFrame } = await import('../registry/record-frame.tsx')
  await render(createElement(RecordFrame, { mode: 'sheet', title: 'Edit', closeLabel: 'Close', onClose: () => {}, children: 'x' }))
  assert.match(window.document.querySelector('[data-slot="sheet-content"]')!.className, /data-\[side=right\]:w-full/, 'the record sheet is full width below sm')
})

test('the theme provider hands its consumers one value from the first render on, stored theme or not, so nothing it holds changes a screen still hydrating', async () => {
  // A context value that changes after the first commit reaches every consumer; one inside a Suspense boundary still waiting on its files makes React drop the server's HTML there and draw the empty fallback.
  const { ThemeProvider, useTheme } = await import('../registry/theme.tsx')
  // 'stale' is none of the three this toggle offers, like a value left by another version of this key or another app at the same origin: it is checked before use and falls back to the default.
  for (const stored of [null, 'light', 'stale']) {
    if (stored) window.localStorage.setItem('vite-ui-theme', stored)
    else window.localStorage.removeItem('vite-ui-theme')
    const seen: unknown[] = []
    const Consumer = () => {
      seen.push(useTheme())
      return null
    }
    const root = createRoot(mount())
    await act(async () => root.render(createElement(ThemeProvider, { defaultTheme: 'dark', storageKey: 'vite-ui-theme', children: createElement(Consumer) })))
    await act(async () => sleep(0))
    assert.equal(new Set(seen).size, 1, `a consumer is handed one value with ${stored ?? 'no'} theme stored`)
    assert.equal((seen[0] as { theme: string }).theme, stored === 'light' ? stored : 'dark', 'and it is the stored theme when it is one of the three, or the default')
    await act(async () => root.unmount())
  }
  window.localStorage.removeItem('vite-ui-theme')
})

test('the dashboard\'s loader counts the courses, sums the fees of those not archived per currency and reads each day\'s enrollments, and the page draws what it answered', async () => {
  await stubbed(async () => {
    const today = new Date().toISOString().slice(0, 10)
    const asked: string[] = []
    const client: ScreenState['client'] = async ({ kayan, operation, input }) => {
      asked.push(`${kayan}.${operation}`)
      if (operation === 'count') return { totalDocs: 7 }
      assert.equal(input.limit, screen.maxLimit, 'every read asks for as many rows as a served read answers')
      // Two pages of courses, so a sum over the first alone is caught. A fee with no currency is never added to another.
      if (kayan === 'courses') return input.page === 1 ? { docs: [{ fee: 100, currency: 'SAR' }, { fee: 50, currency: 'SAR', archived: true }], totalPages: 2 } : { docs: [{ fee: 20, currency: 'USD' }, { fee: 999, currency: null }], totalPages: 2 }
      assert.match(String((input.where as { createdAt: { greater_than_equal: string } }).createdAt.greater_than_equal), /T00:00:00\.000Z$/, 'the range starts at a day\'s first instant')
      // One as a `Date`, as an operation answers in process, and one as the string HTTP answers.
      return { docs: [{ createdAt: new Date(`${today}T08:00:00.000Z`) }, { createdAt: `${today}T09:00:00.000Z` }], totalPages: 1 }
    }
    const priced = { read: true, fields: { fee: { read: true }, currency: { read: true } } }
    const access = { collections: { courses: priced, enrollments: { read: true } } }
    const figures = await dashboardLoader({ client, access, request: fetch, maxLimit: screen.maxLimit })
    assert.deepEqual(asked.sort(), ['courses.find', 'courses.find', 'enrollments.count', 'enrollments.find'])
    const host = await render(createElement(Dashboard, { loaderData: figures }), { kayan: undefined })
    const value = (kpi: string) => host.querySelector(`[data-kpi="${kpi}"] [data-slot="card-title"]`)!.textContent
    assert.equal(value('courses'), '4', 'four courses, the rows of the same read the list makes, drawn from the first render')
    assert.match(host.querySelector('[data-kpi="courses"]')!.textContent!, /3 not archived/, 'three of them open')
    // One sum per line, each isolated left to right, so Arabic neither reads "US$" as "$US" nor strands a separator.
    const sums = [...host.querySelectorAll('[data-kpi="fees"] bdi')]
    assert.deepEqual(sums.map((one) => one.textContent?.replace(/\s/g, ' ')), ['SAR 100.00', '$20.00'], 'a sum per currency, since a riyal and a dollar do not add up, none for the fee with no currency, and none of an archived course\'s')
    assert.equal(sums.every((one) => one.getAttribute('dir') === 'ltr'), true, 'each in its own left-to-right isolate')
    assert.equal(value('enrollments'), '7', 'every enrollment, counted')
    assert.equal(value('recent'), '2', 'and the two of the range')
    assert.ok(host.querySelector('[data-chart-card="enrollments"] [data-slot="chart"]'), 'drawn as an area chart')
    assert.equal(host.querySelector('[data-kpi="members"]'), null, 'and no Members card to a viewer who may not list members')
    const listing = async () => Response.json({ members: [{ userId: 'u1', role: 'owner', createdAt: '2026-01-01T00:00:00.000Z', user: { name: 'Sana', email: 'sana@example.com' } }], total: 1 })
    const staffed = await render(createElement(Dashboard, { loaderData: await dashboardLoader({ client, access: { ...access, permissions: ['member.find'] } as never, request: listing, maxLimit: screen.maxLimit }) }), { kayan: undefined })
    assert.equal(staffed.querySelector('[data-kpi="members"] [data-slot="card-title"]')?.textContent, '1', 'while one who may is drawn how many work here')
    assert.equal(staffed.querySelector('[data-kpi="members"] a')?.getAttribute('href'), '/dashboard/members', 'with a link to the Members page')

    // An actor the report does not let read enrollments is asked nothing about them and shown neither figure nor chart.
    asked.length = 0
    const narrow = await render(createElement(Dashboard, { loaderData: await dashboardLoader({ client, access: { collections: { courses: { read: true } } }, request: fetch, maxLimit: screen.maxLimit }) }), { kayan: undefined })
    assert.deepEqual(asked.sort(), ['courses.find', 'courses.find'])
    assert.equal(narrow.querySelector('[data-kpi="enrollments"]'), null)
    assert.equal(narrow.querySelector('[data-chart-card]'), null)
    // A reader of the fee and not of its currency is drawn no total at all rather than riyals and dollars added up.
    for (const fields of [{}, { fee: { read: true } }, { currency: { read: true } }] as Record<string, { read: boolean }>[]) {
      const unpriced = await render(createElement(Dashboard, { loaderData: await dashboardLoader({ client, access: { collections: { courses: { read: true, fields } } }, request: fetch, maxLimit: screen.maxLimit }) }), { kayan: undefined })
      assert.equal(unpriced.querySelector('[data-kpi="fees"]'), null, `no fees card for a reader of ${Object.keys(fields).join(' and ') || 'neither field'}`)
    }
    const arabic = await render(createElement(Dashboard, { loaderData: figures }), { kayan: undefined, locale: 'ar', dir: 'rtl' })
    const said = [...arabic.querySelectorAll('[data-kpi="fees"] bdi')]
    assert.equal(said.length, 2, 'two lines in Arabic too')
    assert.equal(said.every((one) => one.getAttribute('dir') === 'ltr'), true, 'each a left-to-right isolate')
    assert.ok(said.some((one) => /US\$/.test(one.textContent ?? '')) && !said.some((one) => /\$US/.test(one.textContent ?? '')), `the dollar sum keeps its sign: ${said.map((one) => one.textContent).join(' | ')}`)
    // Before the figures arrive the card is drawn with the placeholder, as every card is, so the grid does not shift.
    const waiting = await render(createElement(Dashboard, { loaderData: undefined as never }), { kayan: undefined })
    assert.equal(waiting.querySelector('[data-kpi="fees"] [data-slot="card-title"]')?.textContent, '…', 'the fees card waits with the others')
  })
})

const arabic = { ...state, locale: 'ar', dir: 'rtl' as const }

test('144a. a picker names the row it holds by its title in the viewer\'s locale, one or many, and its box says nothing in a kayan\'s own name', async () => {
  const rows: Record<string, readonly Record<string, unknown>[]> = { courses: [{ id: 'c9', title: 'Tajweed' }], tags: [{ id: 't1', name: { en: 'Weekend', ar: 'عطلة' } }] }
  // The host passes a fresh reader object on every render, each read answering a moment later as a request does.
  const fresh = (): FindApi => Object.fromEntries(Object.entries(rows).map(([target, docs]) => [target, {
    find: async (input: Record<string, unknown>) => {
      await sleep(5)
      const wanted = (input.where as { id?: { in?: readonly string[] } }).id?.in
      return { docs: wanted ? docs.filter((row) => wanted.includes(String(row.id))) : docs, hasNextPage: false, nextPage: null }
    },
  }]))
  const course = sessions.fields.find((one) => one.name === 'course')!
  const tags = courses.fields.find((field) => field.name === 'tags')!
  const picker = (locale: string) => [
    createElement(RelationshipControl, { values: {}, setValue: () => {}, field: course, kayan: sessions, client: kayans, api: fresh(), id: 'sessions-course', t, locale, value: 'c9', readOnly: false, onChange: () => {} }),
    createElement(RelationshipControl, { values: {}, setValue: () => {}, field: tags, kayan: courses, client: kayans, api: fresh(), id: 'courses-tags', t, locale, value: ['t1'], readOnly: false, onChange: () => {} }),
  ]
  const host = mount()
  const root = createRoot(host)
  const draw = () => root.render(createElement(ScreenContext, { value: arabic }, createElement(StrictMode, null, ...picker('ar'))))
  await act(async () => draw())
  // The host renders again before either answer lands.
  await act(async () => draw())
  await act(async () => { await sleep(30) })
  assert.equal((host.querySelector('#sessions-course') as unknown as HTMLInputElement).value, 'Tajweed', 'the held course reads as its title, not its id')
  const chips = [...host.querySelectorAll('[data-slot="combobox-chip"]')].map((chip) => chip.textContent?.trim())
  assert.deepEqual(chips, ['عطلة'], 'a localized title reads in the viewer\'s locale')
  const box = host.querySelector('#courses-tags') as unknown as HTMLInputElement
  assert.notEqual(box.placeholder, 'tags', 'the box says nothing in a kayan\'s own name')
  await act(async () => root.unmount())
})

test('144b. a localized title is searched in the viewer\'s locale and orders no page, since no sort can name it', async () => {
  const { api, calls } = fakeApi({ tags: [{ id: 't1', name: { en: 'Weekend', ar: 'عطلة' } }] })
  const tags = courses.fields.find((field) => field.name === 'tags')!
  const host = await render(createElement(RelationshipControl, {
    values: {}, setValue: () => {}, field: tags, kayan: courses, client: kayans, api, id: 'courses-tags', t, locale: 'ar', value: [], readOnly: false, onChange: () => {},
  }), arabic)
  await act(async () => click(host.querySelector('#courses-tags') as unknown as Element))
  assert.equal(calls[0]!.input.sort, undefined, 'the page is not sorted on a localized title')
  assert.ok(opened()?.textContent?.includes('عطلة'), 'and each row reads in the viewer\'s locale')
  await act(async () => typeInto(host.querySelector('#courses-tags') as unknown as Element, 'عط'))
  await debounced()
  assert.deepEqual(calls.at(-1)!.input.where, { id: { not_in: [] }, 'name.ar': { like: 'عط' } }, 'the term runs over the viewer\'s locale of the title')
})

test('144d. a cell reads a localized value and an option in the viewer\'s locale', () => {
  const venue = sessions.fields.find((one) => one.name === 'venue')!
  const name = fieldOf({ name: 'name', kind: 'text', rules: { localized: true } })
  assert.equal(cells.text!({ kayan: sessions, field: venue, value: 'campus', t, locale: 'ar' }), 'الحرم')
  assert.equal(cells.text!({ kayan: sessions, field: name, value: { en: 'Weekend', ar: 'عطلة' }, t, locale: 'ar' }), 'عطلة')
})

test('144e. a localized field draws one box per locale and writes the whole object', async () => {
  const written: Record<string, unknown>[] = []
  const client = { create: async (input: Record<string, unknown>) => (written.push(input), {}), update: async () => ({}), delete: async () => ({}) }
  const name = fieldOf({ name: 'name', kind: 'text', label: { en: 'Name', ar: 'الاسم' }, rules: { localized: true, required: true } })
  const tags = { name: 'tags', single: false, fields: [name], operations: [], pages: {} } as unknown as ClientKayan
  const host = await render(createElement(Form, {
    kayan: tags, screen: screenOf(recordPage([{ form: [{ field: 'name' }] }]), tags), client, value: null, t, locale: 'ar', locales: ['ar', 'en'], onDone: () => {},
  }), { ...arabic, kayan: tags })
  const boxes = [...host.querySelectorAll('input[name="name"]')] as unknown as HTMLInputElement[]
  assert.equal(boxes.length, 2, 'one box per declared locale')
  await act(async () => typeInto(boxes[0] as unknown as Element, 'عطلة'))
  await act(async () => typeInto(boxes[1] as unknown as Element, 'Weekend'))
  await act(async () => fire(host.querySelector('form')!, 'submit'))
  assert.deepEqual(written[0], { name: { ar: 'عطلة', en: 'Weekend' } })
})

test('144f. a create page draws every field it names, a timestamp the server fills included, since no field is hidden by a rule', async () => {
  const host = await render(createElement(Form, {
    kayan: courses, screen: screenOf(recordPage([{ form: ['title', { field: 'createdAt', readOnly: true }] }])),
    client: { create: async () => ({}), update: async () => ({}), delete: async () => ({}) }, value: null, t, locale: 'en', onDone: () => {},
  }))
  assert.ok(host.querySelector('[data-field-value="createdAt"]'), 'the page named it, so it is drawn')
  assert.equal(host.querySelector('#courses-createdAt'), null, 'as text, not as a control')
})

test('145a. a list of another kayan edits one row in a drawer over the page, adds one holding the page\'s row, archives the ticked ones in bulk, and sits outside the page\'s own form', async () => {
  // The course edit page as the dashboard projects it, its Sessions tab a list of `sessions` whose `course` is this row.
  const edit = courses.pages.edit as Extract<PageClient, { page: unknown }>
  const writes: { write: string; input: Record<string, unknown> }[] = []
  const pageWrites: Record<string, unknown>[] = []
  const ran: { operation: string; input: Record<string, unknown> }[] = []
  const record = (write: string) => async (input: Record<string, unknown>) => {
    writes.push({ write, input })
    return { id: 'made', ...input }
  }
  const docs = [
    { id: 's1', course: 'c1', startsAt: '2026-10-01T10:00:00.000Z', capacity: 5, venue: 'campus', format: 'lecture', archived: false },
    { id: 's2', course: 'c1', startsAt: '2026-10-02T10:00:00.000Z', capacity: 8, venue: 'online', format: 'workshop', archived: false },
  ]
  let listed: import('../registry/node-tree.ts').ListNode | undefined
  const host = await render(
    createElement(Form, {
      kayan: courses,
      screen: screenOf(edit),
      client: { create: async () => ({}), update: async (input: Record<string, unknown>) => (pageWrites.push(input), {}), delete: async () => ({}) },
      value: { id: 'c1', title: 'Tajweed' },
      t,
      locale: 'en',
      onDone: () => {},
      related: ({ node }) => {
        listed = node
        return createElement(List, {
          key: 'sessions',
          kayan: sessions,
          node,
          page: pageOf(docs),
          query: {},
          t,
          locale: 'en',
          onQuery: () => {},
          href: (id: string) => `/sessions/${id}`,
          newHref: '#',
          screen: screenOf(edit),
          creates: true,
          operations: { update: true, archiveMany: true },
          writes: () => true,
          run: async (operation: string, input: Record<string, unknown>) => void ran.push({ operation, input }),
          edit: {
            client: { create: record('create'), update: record('update'), delete: record('delete') },
            writes: () => true,
            prefill: { course: 'c1' },
          },
        })
      },
    }),
  )
  assert.ok(listed?.of === 'sessions' && listed.where === 'course', 'the course edit page lists sessions where course')
  const pageForm = host.querySelector('[data-node="form"] form')!
  assert.ok(pageForm, 'the page\'s form node is the page\'s one form')
  const table = host.querySelector('table')!
  assert.equal(pageForm.contains(table), false, 'and the list is not inside it')
  const button = (text: string, within: ParentNode = host) => [...within.querySelectorAll('button')].find((one) => one.textContent?.trim() === text)!
  assert.ok(host.querySelector('h2'), 'the list is headed as a part of the page')
  assert.equal(window.document.querySelector('[data-mithaq-inline-edit]'), null, 'no row is being edited to begin with')

  const rows = () => [...host.querySelectorAll('tbody tr')]
  const editRow = async (row: Element) => {
    await act(async () => click(row.querySelector('[data-row-menu]')! as unknown as Element))
    await act(async () => click(window.document.querySelector('[data-row-action="edit"]')! as unknown as Element))
  }
  await editRow(rows()[0]!)
  const inline = () => window.document.querySelector('[data-mithaq-inline-edit]') as unknown as Element
  assert.equal(inline().getAttribute('data-mithaq-inline-edit'), 's1')
  assert.equal(inline().closest('table'), null, 'in a drawer over the page, not inside the table')
  assert.ok(inline().querySelector('#sessions-capacity'), 'drawing the list\'s own columns')
  assert.equal(inline().querySelector('[data-shell], [data-layout]'), null, 'with no shell or layout around them')
  assert.equal(host.querySelectorAll('form form').length, 0, 'and no form is inside another')
  await editRow(rows()[1]!)
  assert.equal(window.document.querySelectorAll('[data-mithaq-inline-edit]').length, 1, 'one row at a time')
  assert.equal(inline().getAttribute('data-mithaq-inline-edit'), 's2')
  const capacity = inline().querySelector('#sessions-capacity') as unknown as HTMLInputElement
  await act(async () => typeInto(capacity as unknown as Element, '9'))
  assert.notEqual(capacity.form, pageForm as unknown, 'a box of the row belongs to the row\'s form, so Enter in it submits that form and never the page\'s')
  await act(async () => fire(capacity.form as unknown as Element, 'submit'))
  assert.deepEqual([...writes], [{ write: 'update', input: { capacity: 9, id: 's2' } }], 'the save is the session\'s own update, of what changed')
  assert.deepEqual(pageWrites, [], 'and the page\'s own form saved nothing')
  assert.equal(window.document.querySelector('[data-mithaq-inline-edit]'), null, 'the form closes once the write lands')

  await act(async () => click(button('New') as unknown as Element))
  assert.equal(inline().getAttribute('data-mithaq-inline-edit'), 'new')
  await act(async () => click(inline().querySelector('button#sessions-startsAt')! as unknown as Element))
  await act(async () => click(window.document.querySelector('[data-today] button')! as unknown as Element))
  await typeTime(inline(), '09:30')
  await act(async () => fire(inline().querySelector('form')!, 'submit'))
  assert.equal(writes[1]?.write, 'create')
  assert.equal(writes[1]?.input.course, 'c1', 'the new session holds this course, which the form never drew')
  assert.deepEqual(pageWrites, [])

  const boxes = () => [...host.querySelectorAll('tbody [role="checkbox"]')]
  await act(async () => click(boxes()[0]! as unknown as Element))
  await act(async () => click(boxes()[1]! as unknown as Element))
  await act(async () => click(button('Archive', table.closest('section')!) as unknown as Element))
  const asked = await confirmYes()
  assert.ok(asked?.includes('Archive the ticked sessions?'), 'it asks the question its node carries')
  assert.deepEqual(ran, [{ operation: 'archiveMany', input: { where: { id: { in: ['s1', 's2'] } } } }], 'and sends the ticked ids and no value')
})

test('146a. an enrollment\'s student reads as the person\'s name and its organization by its name, in the list\'s cell and in the picker, off the dashboard\'s own projection', async () => {
  assert.equal(screen.kayan.user?.useAsTitle, 'name')
  assert.equal(screen.kayan.organization?.useAsTitle, 'name')
  assert.ok(!screen.nav.some((entry) => entry.kayan === 'user' || entry.kayan === 'organization'), 'and neither has a page or a nav entry')
  const rows = { user: [{ id: 'u1', name: 'Amal' }], organization: [{ id: 'o1', name: 'Asma School' }], sessions: [{ id: 's1', startsAt: '2031-01-01T00:00:00.000Z' }] }
  const host = await render(
    createElement(List, {
      kayan: enrollments,
      client: kayans,
      api: fakeApi(rows).api,
      page: { docs: [{ id: 'e1', session: 's1', student: 'u1', organization: 'o1' }], hasNextPage: false, hasPrevPage: false, limit: 10, nextPage: null, page: 1, prevPage: null, totalDocs: 1, totalPages: 1 },
      query: { cols: ['student', 'organization'] },
      t,
      locale: 'en',
      onQuery: () => {},
      href: (id: string) => `/enrollments/${id}`,
      newHref: '/enrollments/new',
    }),
  )
  await act(async () => { await sleep(10) })
  const text = host.querySelector('tbody')?.textContent ?? ''
  assert.ok(text.includes('Amal') && text.includes('Asma School'), `the cells name the person and the organization: ${text}`)
  assert.ok(!text.includes('u1') && !text.includes('o1'), 'and show neither id')

  const field = (name: string) => enrollments.fields.find((one) => one.name === name)!
  const pickers = await render(createElement('div', null,
    createElement(RelationshipControl, { values: {}, setValue: () => {}, field: field('student'), kayan: enrollments, client: kayans, api: fakeApi(rows).api, id: 'enrollments-student', t, locale: 'en', value: 'u1', readOnly: false, onChange: () => {} }),
    createElement(RelationshipControl, { values: {}, setValue: () => {}, field: field('organization'), kayan: enrollments, client: kayans, api: fakeApi(rows).api, id: 'enrollments-organization', t, locale: 'en', value: 'o1', readOnly: true, onChange: () => {} }),
  ))
  await act(async () => { await sleep(10) })
  assert.equal((pickers.querySelector('#enrollments-student') as unknown as HTMLInputElement).value, 'Amal', 'the picker holds the person by name')
  assert.equal((pickers.querySelector('#enrollments-organization') as unknown as HTMLInputElement).value, 'Asma School', 'and the organization by its name')
})

test('146b. a box in a side region, outside the page\'s form node, belongs to the page\'s form, so Enter in it saves the page', async () => {
  // The form node draws the page's one `<form>`, so a leaf in another region names it by id with the `form` attribute, and the browser's implicit submission on Enter reaches it.
  const saved: Record<string, unknown>[] = []
  const page = plus(recordPage([{ form: ['title'] }], '/courses/:id'), 'side', { field: 'summary' })
  const host = await render(createElement(Form, {
    kayan: courses,
    screen: screenOf(page),
    client: { create: async () => ({}), update: async (input: Record<string, unknown>) => (saved.push(input), {}), delete: async () => ({}) },
    value: { id: 'c1', title: 'Tajweed' },
    t,
    locale: 'en',
    onDone: () => {},
  }))
  const pageForm = host.querySelector('[data-node="form"] form') as unknown as HTMLFormElement
  const side = host.querySelector('#courses-summary') as unknown as HTMLInputElement
  assert.ok(pageForm && side)
  assert.equal(pageForm.contains(side as unknown as Node), false, 'the side box is outside the form element')
  assert.ok(side.form === pageForm, 'and the form is its owner all the same')
  await act(async () => typeInto(side as unknown as Element, 'Moved'))
  // Implicit submission as the browser makes it: the form owner of the box Enter was pressed in is submitted.
  await act(async () => side.form?.requestSubmit())
  assert.deepEqual(saved, [{ id: 'c1', summary: 'Moved' }], 'Enter in the side box saves the page, with the side box\'s value')
})

/** Links are caught on the document before happy-dom acts on them, as the screen host's frame routes every link. */
const following = () => {
  const followed: string[] = []
  const follow = (event: Event) => {
    const link = (event.target as Element | null)?.closest?.('a[href]')
    if (!link) return
    event.preventDefault()
    followed.push(link.getAttribute('href')!)
  }
  window.document.addEventListener('click', follow as never)
  return { followed, stop: () => window.document.removeEventListener('click', follow as never) }
}

test('150a. a row opens its record from a click anywhere on it and from Enter, leads with its title, and its menu holds Edit, the row buttons and Delete without opening the row', async () => {
  const calls: { operation: string; input: Record<string, unknown> }[] = []
  const docs = [
    { id: 'c1', title: 'Tajweed', fee: 300, archived: false },
    { id: 'c2', title: 'Nahw', fee: 200, archived: true },
  ]
  const host = await render(
    createElement(List, {
      kayan: courses,
      page: pageOf(docs),
      query: { cols: ['fee', 'archived', 'title'] },
      t,
      locale: 'en',
      onQuery: () => {},
      href: (id: string) => `/courses/${id}`,
      newHref: '/courses/new',
      screen: listScreen(),
      operations: { update: true, archive: true, delete: true },
      run: async (operation: string, input: Record<string, unknown>) => {
        calls.push({ operation, input })
        return {}
      },
    }),
  )
  const heads = [...host.querySelectorAll('thead th')].map((one) => one.textContent?.trim())
  assert.equal(heads[0], 'Title', `the title column comes first: ${heads.join(', ')}`)
  const row = (id: string) => host.querySelector(`tr[data-row="${id}"]`)!
  const { followed, stop } = following()
  try {
    await act(async () => {
      click(row('c1').querySelectorAll('td')[1]! as unknown as Element)
    })
    assert.deepEqual(followed, ['/courses/c1'], 'a click on a cell that is not the title opens the row')
    assert.equal(row('c1').getAttribute('tabindex'), '0', 'the row is a stop of the tab order')
    assert.ok(row('c1').className.split(' ').includes('focus-visible:ring-[3px]'), 'drawing the app\'s focus ring when the keyboard reaches it')
    const hint = window.document.getElementById(row('c1').getAttribute('aria-describedby')!)
    assert.equal(hint?.textContent, 'Press Enter to open this row.', 'and telling a reader that Enter opens it')
    await act(async () => {
      press(row('c2') as unknown as Element, 'Enter')
    })
    assert.deepEqual(followed, ['/courses/c1', '/courses/c2'], 'and Enter on it opens it')

    const trigger = row('c1').querySelector('[data-row-menu]')!
    await act(async () => {
      click(trigger as unknown as Element)
    })
    assert.equal(followed.length, 2, 'pressing the menu opens no row')
    const items = () => [...window.document.querySelectorAll('[data-row-action]')].map((one) => one.getAttribute('data-row-action'))
    assert.deepEqual(items(), ['edit', 'archive', 'delete'], 'Edit, the row buttons whose when holds, then Delete')
    const item = (name: string) => window.document.querySelector(`[data-row-action="${name}"]`)!
    await act(async () => {
      click(item('delete') as unknown as Element)
    })
    assert.equal(followed.length, 2, 'choosing an item opens no row')
    assert.deepEqual(calls, [], 'and the delete is not run by the item alone')
    const dialog = window.document.querySelector('[data-slot="alert-dialog-content"]')!
    assert.ok(dialog.textContent?.includes('This cannot be undone.'), 'its dialog says the delete is for good')
    await act(async () => {
      click(dialog.querySelector('[data-slot="alert-dialog-action"]')! as unknown as Element)
    })
    assert.deepEqual(calls, [{ operation: 'delete', input: { id: 'c1' } }], 'and its confirm deletes that row')

    // An archived row's menu has no Archive, because the button's `when` fails over it.
    await act(async () => {
      click(row('c2').querySelector('[data-row-menu]')! as unknown as Element)
    })
    assert.deepEqual(items(), ['edit', 'delete'], 'a row button whose when fails over the row is not offered')
    await act(async () => {
      click(item('edit') as unknown as Element)
    })
    assert.deepEqual(followed, ['/courses/c1', '/courses/c2', '/courses/c2'], 'and Edit opens the row it was chosen on')
  } finally {
    stop()
  }
})

test('150b. an affix is an addon of its own and never the box\'s hint, and a hint says nothing once the box holds a value', async () => {
  const title = courses.fields.find((one) => one.name === 'title')!
  const fee = courses.fields.find((one) => one.name === 'fee')!
  const control = (field: ClientField, value: unknown, placeholder?: string) =>
    render(createElement(controls[field.kind]!, {
      field, kayan: courses, id: `courses-${field.name}`, t, locale: 'ar', value, values: {}, setValue: () => {},
      readOnly: false, onChange: () => {}, ...(placeholder && { placeholder }),
    }))
  let host = await control(title, 'Tajweed', 'مقدمة في الخط العربي')
  const prefix = host.querySelector('[data-affix="prefix"]')!
  assert.equal(prefix.textContent, 'دورة', 'the prefix is drawn in the viewer\'s locale')
  assert.ok(prefix.className.includes('bg-muted') && prefix.className.includes('border-e'), `on a fill of its own, ruled off the box: ${prefix.className}`)
  assert.ok(prefix.querySelector('span')!.className.split(' ').includes('text-foreground'), 'and in the color a value is drawn in, not a hint\'s')
  assert.equal(host.querySelector('input')!.getAttribute('placeholder'), 'مقدمة في الخط العربي', 'the box\'s own hint is the placeholder alone')
  host = await control(fee, 450)
  const suffix = host.querySelector('[data-affix="suffix"]')!
  assert.equal(suffix.textContent, 'لكل مقعد', 'a suffix the same way')
  assert.ok(suffix.className.includes('bg-muted') && suffix.className.includes('border-s'), `at the inline end, ruled off the box: ${suffix.className}`)

  // A picker holding many rows keeps its hint for an empty box alone: beside a chip it reads as a row nobody chose.
  const tags = courses.fields.find((one) => one.name === 'tags')!
  const { api } = fakeApi({ tags: [{ id: 't1', name: 'Recitation' }] })
  const picker = (value: unknown) => render(createElement(RelationshipControl, {
    field: tags, kayan: courses, client: kayans, api, id: 'courses-tags', t, locale: 'en', value, values: {}, setValue: () => {},
    readOnly: false, onChange: () => {},
  }))
  host = await picker([])
  assert.ok(host.querySelector('#courses-tags')!.getAttribute('placeholder'), 'an empty picker says what it is for')
  host = await picker(['t1'])
  await debounced()
  assert.equal(host.querySelector('#courses-tags')!.getAttribute('placeholder'), null, 'and says nothing once it holds a row')
})

test('150c. the form\'s footer holds Cancel and Save alone, and a page\'s delete button is the two-step dialog, landing on the list', async () => {
  const deleted: Record<string, unknown>[] = []
  const landed: (string | undefined)[] = []
  const edit = plus(recordPage([{ form: ['title'] }]), 'danger', { button: 'delete', label: { en: 'Delete', ar: 'حذف' } })
  const host = await render(
    createElement(Form, {
      kayan: courses,
      screen: screenOf(edit),
      client: {
        create: async () => ({}),
        update: async () => ({}),
        delete: async (input: Record<string, unknown>) => (deleted.push(input), {}),
        run: async () => ({}),
      },
      value: { id: 'a-row', title: 'Tajweed' },
      t: (key: string, fallback?: string) => (key === 'courses.delete.confirm' ? 'Delete this course' : fallback),
      locale: 'en',
      onDone: (_row: unknown, effect?: string) => landed.push(effect),
      onCancel: () => {},
      operations: { delete: true, update: true },
    }),
  )
  const form = host.querySelector('form')!
  const footer = [...form.querySelectorAll('button')].filter((one) => !one.closest('[data-region="danger"]')).map((one) => one.textContent?.trim())
  assert.deepEqual(footer.slice(-2), ['Cancel', 'Save'], `the footer ends in Cancel and Save: ${footer.join(', ')}`)
  assert.ok(!footer.includes('Delete'), 'and holds no delete')
  const trigger = host.querySelector('[data-region="danger"] [data-button="delete"]')!
  assert.ok(trigger, 'the delete is in the danger zone, where the page put it')
  await act(async () => {
    click(trigger as unknown as Element)
  })
  assert.deepEqual(deleted, [], 'one press deletes nothing')
  const dialog = window.document.querySelector('[data-slot="alert-dialog-content"]')!
  assert.ok(dialog.textContent?.includes('This cannot be undone.'), 'its dialog says the delete is for good')
  const confirm = dialog.querySelector('[data-slot="alert-dialog-action"]')!
  assert.equal(confirm.textContent, 'Delete this course', 'in the kayan\'s own words')
  await act(async () => {
    click(confirm as unknown as Element)
  })
  assert.deepEqual(deleted, [{ id: 'a-row' }], 'the second press deletes the row the form holds')
  assert.deepEqual(landed, ['delete'], 'and the host is told it was a delete, which lands on the list')
})

test('171a. a controls node draws the form\'s controls where it sits, the course edit page\'s in the sticky header on every tab, and the form then draws no actions of its own; a page without one keeps them in the form', async () => {
  const calls: DraftCall[] = []
  const updatedAt = new Date(Date.now() - 2 * 3_600_000).toISOString()
  const host = await render(createElement(Form, {
    kayan: courses,
    screen: screenOf(courses.pages.edit!),
    client: draftClient(calls),
    value: { ...draftRow, updatedAt },
    t,
    locale: 'en',
    onDone: () => {},
    onCancel: () => {},
    drafts: { status: 'published' },
  }), { record: draftRow })
  const controls = host.querySelector('[data-region="header"] [data-node="controls"]')!
  assert.ok(controls, 'the controls are drawn in the header')
  assert.ok(!controls.closest('[data-slot="tabs-content"]'), 'outside every tab, so they show on each one')
  assert.equal(host.querySelector('[data-slot="tabs-list"]')?.getAttribute('data-variant'), 'line', 'the page\'s tabs draw the line bar')
  const pill = controls.querySelector('[data-status]')!
  assert.equal(pill.getAttribute('data-status'), 'published')
  assert.equal(pill.getAttribute('data-slot'), 'badge', 'where the row stands is a pill')
  assert.equal(controls.querySelector('[data-updated]')?.textContent, 'Updated 2 hours ago', 'when it was last saved, from the row\'s updatedAt, in the viewer\'s words')
  assert.ok(!controls.querySelector('[data-updated]')!.hasAttribute('title'), 'with no tooltip, whose time zone the server would choose')
  assert.ok(controls.firstElementChild!.className.split(' ').includes('sm:flex-wrap'), 'the row wraps under a header that grows rather than runs past its end, between 640 and 1280 pixels')
  assert.ok(!pill.classList.contains('hidden') && controls.querySelector('[data-updated]')!.classList.contains('hidden') && controls.querySelector('[data-updated]')!.classList.contains('xl:inline'), 'and gives up its updated line below xl, keeping its pill (, #228)')
  assert.ok(controls.firstElementChild!.className.split(' ').includes('min-w-min'), 'and may shrink inside the header to the narrowest it can be drawn, so a long sentence beside it wraps rather than pushes, and never further, so nothing in it is drawn over the title')
  const form = host.querySelector('form')!
  const publish = controls.querySelector('[data-button="publish"]') as HTMLButtonElement
  assert.equal(publish.getAttribute('type'), 'submit')
  assert.equal(publish.getAttribute('form'), form.id, 'Publish changes submits the page\'s one form by its id')
  assert.ok(!form.contains(publish), 'from outside it')
  assert.ok([...controls.querySelectorAll('button')].some((one) => one.textContent?.trim() === 'Cancel'), 'Cancel sits beside it')
  assert.equal(form.querySelectorAll('button[type="submit"]').length, 0, 'and the form draws no save of its own')
  assert.ok(![...form.querySelectorAll('button')].some((one) => one.textContent?.trim() === 'Cancel'), 'nor a Cancel')

  await act(async () => {
    typeInto(host.querySelector('#courses-title')!, 'Tajweed II')
  })
  await act(async () => {
    click(publish)
  })
  assert.deepEqual(calls, [{ operation: 'update', input: { title: 'Tajweed II', id: 'a-row' } }], 'a press in the header saves the form')
  assert.equal(controls.querySelector('[data-updated]')?.textContent, 'Updated now', 'and the last save is the one that just landed')

  // A page that hides its form, as a fixed role's page does, offers no save from its controls either.
  const hidden = { path: '/courses/:id', page: { shell: screen.layouts.app!, header: [{ controls: {} }], main: [{ layout: screen.layouts.record!, when: { 'record.archived': { equals: true } }, main: [{ form: ['title'] }] }] } } as unknown as PageClient
  const hiding = await render(createElement(Form, { kayan: courses, screen: screenOf(hidden), client: draftClient([]), value: draftRow, t, locale: 'en', onDone: () => {}, onCancel: () => {} }), { record: draftRow })
  assert.equal(hiding.querySelectorAll('[data-node="controls"] button').length, 0, 'a page drawing no form draws no controls')

  const plain = await render(createElement(Form, { kayan: courses, screen: screenOf(recordPage([{ form: ['title'] }])), client: draftClient([]), value: draftRow, t, locale: 'en', onDone: () => {} }))
  assert.ok(!plain.querySelector('[data-node="controls"]'), 'a page with no controls node draws none')
  assert.ok(plain.querySelector('form button[type="submit"]'), 'and keeps its save in the form')
})

test('171c. a publish pressed in the header from another tab, refused over no field, says its sentence in a red toast, seen from any tab, and draws nothing in the page', async () => {
  // The in-form banner sits in the Details panel, so a refusal naming no field must not be drawn on a tab nobody is looking at.
  await toasted()
  const refusal = Object.assign(new Error('Conflict'), { status: 409, data: { key: 'error.conflict', params: {} } })
  let failing = true
  const client = draftClient([], async () => {
    if (failing) throw refusal
    return {}
  })
  const host = await render(withToaster(createElement(Form, { kayan: courses, screen: screenOf(courses.pages.edit!), client, value: draftRow, t, locale: 'en', onDone: () => {}, drafts: { status: 'draft' } })), { record: draftRow })
  const sessionsTab = [...host.querySelectorAll('[data-slot="tabs-trigger"]')].find((one) => one.textContent?.trim() === 'Sessions')!
  await act(async () => {
    click(sessionsTab)
  })
  await act(async () => {
    click(host.querySelector('[data-node="controls"] [data-button="publish"]')!)
  })
  assert.deepEqual(await toasted(), ['error: Something went wrong, so nothing was saved. Try again.'], 'the refusal is said once, in a toast outside every tab panel')
  assert.equal(host.querySelectorAll('[role="alert"]').length, 0, 'and nothing is drawn in the header or a tab')

  // The next Publish says it landed.
  failing = false
  await act(async () => {
    click(host.querySelector('[data-node="controls"] [data-button="publish"]')!)
  })
  assert.deepEqual(await toasted(), ['success: courses published'], 'a Publish that succeeds says so, and leaves no alert')
  assert.equal(host.querySelectorAll('[role="alert"]').length, 0)
})

test('171d. a refusal naming a field, on a page with a controls node, draws under its box, badges the Details tab, and lists it in the form\'s summary, never in the header', async () => {
  const refusal = Object.assign(new Error('Bad Request'), { status: 400, data: { key: 'error.invalid.value', params: { issues: [{ path: 'title', message: 'A published course needs a title.' }] } } })
  const host = await render(createElement(Form, { kayan: courses, screen: screenOf(courses.pages.edit!), client: draftClient([], async () => {
    throw refusal
  }), value: draftRow, t, locale: 'en', onDone: () => {}, drafts: { status: 'draft' } }), { record: draftRow })
  await act(async () => {
    click(host.querySelector('[data-node="controls"] [data-button="publish"]')!)
  })
  const box = host.querySelector('#courses-title')!.closest('[data-slot="field"]')
  assert.ok(box, 'the title has a field wrapper')
  assert.ok(box.textContent?.includes('A published course needs a title.'), 'the sentence is under the title box')
  const details = [...host.querySelectorAll('[data-slot="tabs-trigger"]')].find((one) => one.textContent?.includes('Details'))!
  assert.equal(details.querySelector('[data-mithaq-invalid]')?.getAttribute('data-mithaq-invalid'), '1', 'the Details tab counts the refused field')
  assert.equal(host.querySelectorAll('[data-region="header"] [role="alert"]').length, 0, 'the header says nothing of it')
  assert.ok(host.querySelector('form [data-error-summary]')?.textContent?.includes('A published course needs a title.'), 'the summary at the top of the form names it')
})

test('171b. Save draft is offered on a kayan that keeps drafts, whether or not it autosaves, and never to an actor without the key', async () => {
  const autosaving = await render(createElement(Form, { kayan: courses, client: draftClient([]), value: draftRow, t, locale: 'en', onDone: () => {}, drafts: { status: 'published', autosave: 2000 } }))
  assert.ok(buttonNamed(autosaving, 'Save draft'), 'an edit that autosaves still offers Save draft')
  assert.ok(publishOf(autosaving), 'beside Publish changes')
  const drafting = await render(createElement(Form, { kayan: courses, client: draftClient([]), value: draftRow, t, locale: 'en', onDone: () => {}, drafts: { status: 'published' } }))
  assert.ok(buttonNamed(drafting, 'Save draft'), 'an edit that does not autosave offers it too')
  const keyless = await render(createElement(Form, { kayan: courses, client: draftClient([]), value: draftRow, t, locale: 'en', onDone: () => {}, drafts: undefined }))
  assert.equal(!!buttonNamed(keyless, 'Save draft') || !!publishOf(keyless), false, 'an actor without findVersions gets neither')
  assert.ok(buttonNamed(keyless, 'Save'), 'and keeps the plain Save')
})

test('174a. Publish changes is green and Save draft amber, in both themes, and the plain Save keeps its look', async () => {
  const classes = (host: HTMLElement, words: string) => buttonNamed(host, words)!.className.split(' ')
  const pair = await render(createElement(Form, { kayan: courses, client: draftClient([]), value: draftRow, t, locale: 'en', onDone: () => {}, drafts: { status: 'changed', autosave: 2000 } }))
  const publish = classes(pair, 'Publish changes')
  assert.deepEqual(['bg-emerald-700', 'text-white', 'dark:bg-emerald-500', 'dark:text-emerald-950', 'focus-visible:ring-emerald-600/40'].filter((one) => !publish.includes(one)), [], 'Publish changes is green with readable text and a green focus ring, in both themes')
  assert.equal(publish.includes('bg-primary'), false, 'in place of the primary colour')
  const draft = classes(pair, 'Save draft')
  assert.deepEqual(['bg-amber-500', 'text-amber-950', 'dark:bg-amber-400', 'focus-visible:ring-amber-500/50'].filter((one) => !draft.includes(one)), [], 'Save draft is amber with readable text and an amber focus ring, in both themes')
  const plain = await render(createElement(Form, { kayan: courses, client: draftClient([]), value: draftRow, t, locale: 'en', onDone: () => {} }))
  assert.equal(classes(plain, 'Save').some((one) => /emerald|amber/.test(one)), false, 'the plain Save on a kayan without drafts keeps its look')
})

const backoffice = asas.targets.backoffice.client

test('155a. a backoffice record page draws each field it names by its cell under its label, in its sections, a relationship by the row\'s title, and a field the report hides not at all; no box takes input and nothing on it writes', async () => {
  const { FieldValue } = await import('../registry/field-value.tsx')
  const { pageOf: drawPage, frameOf } = await import('../registry/nodes.tsx')
  const full = backoffice.kayan.courses!
  const view = full.pages.view as Extract<PageClient, { page: unknown }> | undefined
  assert.equal(view?.path, '/courses/:id', 'a course has a page of its own on the backoffice')
  // What the host crosses for support: the course without its access code, since the report denies the column.
  const kayan = { ...full, fields: full.fields.filter((one) => one.name !== 'accessCode') }
  const row = { id: 'c1', organization: 'o1', title: 'Tajweed', fee: 300, currency: 'SAR', archived: false, tags: ['t1'], accessCode: 'SECRET', createdAt: '2026-09-01T10:00:00.000Z' }
  const { api, calls } = fakeApi({ organization: [{ id: 'o1', name: 'Noor Academy' }], tags: [{ id: 't1', name: { en: 'Recitation', ar: 'تلاوة' } }], courses: [row] })
  const writes: string[] = []
  const wrote = (name: string) => async () => (writes.push(name), {})
  const copy = { t, locale: 'en' }
  const shell = ({ regions }: { regions: Record<string, ReactElement> }) => createElement('div', null, regions.main)
  const page = { refs: { [backoffice.layouts.app!]: shell, [backoffice.layouts.record!]: RecordPage } as never, kayan, page: view! }
  const sessionsOf = backoffice.kayan.sessions!
  const host = await render(createElement('div', null,
    drawPage(page, {
      kayan,
      copy,
      issues: {},
      scope: {},
      component: () => null,
      layout: ({ path, regions, index }) => frameOf({ screen: page, t, path, regions, key: index }),
      control: (leaf) => {
        const field = kayan.fields.find((one) => one.name === (typeof leaf === 'string' ? leaf : leaf.field))
        return field ? createElement(FieldValue, { key: field.name, kayan, field, leaf: typeof leaf === 'string' ? undefined : leaf, row, copy, api, kayans: Object.values(backoffice.kayan) }) : null
      },
      // The course's sessions, as the host hands a list of another kayan to a read-only actor: the report allows no operation and no field write.
      list: ({ node, index }) =>
        createElement(List, {
          key: index,
          kayan: sessionsOf,
          node,
          page: pageOf([{ id: 's1', course: 'c1', startsAt: '2026-10-01T09:00:00.000Z', capacity: 12, venue: 'campus' }]),
          query: {},
          t,
          locale: 'en',
          onQuery: () => {},
          href: (id: string) => `/backoffice/sessions/${id}`,
          newHref: '#',
          creates: false,
          operations: {},
          writes: () => false,
          run: async (operation: string) => (writes.push(operation), {}),
          edit: { client: { create: wrote('create'), update: wrote('update'), delete: wrote('delete') }, writes: () => false, prefill: { course: 'c1' } },
        }),
    })),
    { screen: backoffice, kayan, record: row },
  )
  await act(async () => {})
  // The sessions list keeps its search, filter and page boxes, which ask for rows and write none.
  const boxes = [...host.querySelectorAll('input, textarea, select, form, [contenteditable="true"]')].filter((one) => !one.closest('[data-node="list"]'))
  assert.deepEqual(boxes.map((one) => one.outerHTML.slice(0, 200)), [], 'no field is a box that takes input')
  const value = (name: string) => host.querySelector(`[data-field-value="${name}"]`)?.textContent ?? ''
  assert.ok(value('title').includes('Title') && value('title').includes('Tajweed'), `a field is its label over its value: ${value('title')}`)
  assert.ok(value('fee').includes('300'), 'a number by its cell')
  assert.ok(value('organization').includes('Noor Academy'), `the organization by its name: ${value('organization')}`)
  assert.ok(value('tags').includes('Recitation'), 'and a relationship by the row\'s title in the viewer\'s locale')
  assert.equal(host.querySelector('[data-field-value="accessCode"]'), null, 'a field the report hides is not drawn')
  assert.ok(!host.textContent!.includes('SECRET'), 'and its value is nowhere')
  assert.ok(host.textContent!.includes('About the course'), 'the fields sit in the dashboard\'s sections')
  assert.ok(host.querySelector('tr[data-row="s1"]'), 'and the course\'s sessions are listed')
  for (const button of [...host.querySelectorAll('button')]) await act(async () => click(button as unknown as Element))
  const { followed, stop } = following()
  try {
    await act(async () => click(host.querySelector('tr[data-row="s1"] [data-row-menu]')! as unknown as Element))
    const items = [...window.document.querySelectorAll('[data-row-action]')]
    assert.deepEqual(items.map((one) => [one.getAttribute('data-row-action'), one.textContent]), [['view', 'View']], 'a session\'s menu offers View and nothing that writes')
    await act(async () => click(items[0]! as unknown as Element))
    assert.deepEqual(followed, ['/backoffice/sessions/s1'], 'which opens the session\'s own record')
  } finally {
    stop()
  }
  assert.deepEqual(writes, [], 'nothing on the page wrote')
  assert.ok(calls.length > 0 && calls.every((one) => one.input.where !== undefined), 'and every request it sent was a read of titles')
})

test('155b. a row opens from a click on a cell that is not a box of its own, and a click on a select in a cell opens nothing', async () => {
  const Pick = () => createElement('select', { 'data-pick': '' }, createElement('option', null, 'one'))
  const tree = courses.pages.list as Extract<PageClient, { page: unknown }>
  const host = await render(
    createElement(List, {
      kayan: courses,
      page: pageOf([{ id: 'c1', title: 'Tajweed', fee: 300 }]),
      query: {},
      t,
      locale: 'en',
      onQuery: () => {},
      href: (id: string) => `/courses/${id}`,
      newHref: '#',
      operations: {},
      screen: {
        ...screenOf(tree),
        refs: { pick: Pick } as never,
        page: { ...tree, page: JSON.parse(JSON.stringify(tree.page).replace(/"field":"fee","cell":"[^"]*"/, '"field":"fee","cell":"pick"')) },
      },
    }),
  )
  assert.ok(host.querySelector('[data-pick]'), 'the cell draws its select')
  const { followed, stop } = following()
  try {
    await act(async () => click(host.querySelector('[data-pick]')! as unknown as Element))
    assert.deepEqual(followed, [], 'a click on the select opens nothing')
    await act(async () => click(host.querySelector('tr[data-row="c1"] [data-row-menu]')! as unknown as Element))
    assert.deepEqual([...window.document.querySelectorAll('[data-row-action]')].map((one) => one.textContent), ['View'], 'and a row the report lets nobody update reads View in its menu')
  } finally {
    stop()
  }
})

type DraftCall = { operation: 'create' | 'update'; input: Record<string, unknown>; options?: { draft?: boolean; autosave?: boolean } }
const draftClient = (calls: DraftCall[], answer: (call: DraftCall) => Promise<unknown> = async () => ({})) => ({
  create: (input: Record<string, unknown>, options?: DraftCall['options']) => {
    calls.push({ operation: 'create', input, ...(options && { options }) })
    return answer(calls.at(-1)!)
  },
  update: (input: Record<string, unknown>, options?: DraftCall['options']) => {
    calls.push({ operation: 'update', input, ...(options && { options }) })
    return answer(calls.at(-1)!)
  },
  delete: async () => ({}),
})
const buttonNamed = (host: HTMLElement, words: string) => [...host.querySelectorAll('button')].find((one) => one.textContent?.trim() === words) as HTMLButtonElement | undefined
/** Publish, which reads Publish changes on a published record and Publish on one never published. */
const publishOf = (host: HTMLElement) => (host.querySelector('[data-button="publish"]') ?? undefined) as HTMLButtonElement | undefined
/** Cancel, which reads Back to list beside a draft that saves itself. */
const cancelOf = (host: HTMLElement) => buttonNamed(host, 'Cancel') ?? buttonNamed(host, 'Back to list')
const draftRow = { id: 'a-row', title: 'Tajweed', summary: 'A short summary', fee: 300, archived: false }

test('132a. a form over a kayan that keeps drafts offers Save draft and Publish changes in place of Save, and a draft save sends the draft word and skips the rules a publish holds', async () => {
  const calls: DraftCall[] = []
  const host = await render(createElement(Form, { kayan: courses, client: draftClient(calls), value: draftRow, t, locale: 'en', onDone: () => {}, drafts: { status: 'published' } }))
  assert.ok(!buttonNamed(host, 'Save'), 'there is no plain Save')
  assert.equal(buttonNamed(host, 'Save draft')?.disabled, true, 'Save draft waits for a change on an update, as Payload\'s does')
  assert.equal(publishOf(host)?.disabled, true, 'and so does Publish on a published row with nothing pending')
  await act(async () => {
    typeInto(host.querySelector('#courses-title')!, 'x'.repeat(121))
  })
  assert.equal(buttonNamed(host, 'Save draft')?.disabled, false)
  await act(async () => {
    click(buttonNamed(host, 'Save draft')!)
  })
  assert.deepEqual(calls, [{ operation: 'update', input: { title: 'x'.repeat(121), id: 'a-row' }, options: { draft: true } }], 'a draft holds kinds and not rules, so a title past its length is saved as a draft')

  calls.length = 0
  const refusing = await render(createElement(Form, { kayan: courses, client: draftClient(calls), value: draftRow, t, locale: 'en', onDone: () => {}, drafts: { status: 'published' } }))
  await act(async () => {
    typeInto(refusing.querySelector('#courses-title')!, 'x'.repeat(121))
  })
  await act(async () => {
    click(publishOf(refusing)!)
  })
  assert.deepEqual(calls, [], 'and a publish is refused the same title before any request')

  // A row that is itself a draft, or published with a draft pending, is published as it stands: Publish needs no change first.
  for (const status of ['draft', 'changed'] as const) {
    calls.length = 0
    const pending = await render(createElement(Form, { kayan: courses, client: draftClient(calls), value: draftRow, t, locale: 'en', onDone: () => {}, drafts: { status } }))
    assert.equal(publishOf(pending)?.disabled, false, `Publish is offered on a ${status} row with nothing changed`)
    await act(async () => {
      click(publishOf(pending)!)
    })
    assert.deepEqual(calls, [{ operation: 'update', input: { id: 'a-row' } }], 'and publishes the pending draft, a plain write naming the row alone')
  }

  calls.length = 0
  const created = await render(createElement(Form, { kayan: courses, client: draftClient(calls), value: null, t, locale: 'en', onDone: () => {}, drafts: {} }))
  await act(async () => {
    typeInto(created.querySelector('#courses-title')!, 'Tajweed')
  })
  await act(async () => {
    click(buttonNamed(created, 'Save draft')!)
  })
  const [made] = calls as DraftCall[]
  assert.equal(made?.operation, 'create')
  assert.deepEqual(made?.options, { draft: true }, 'a create saved as a draft carries the draft word')

  // An actor the host hands no drafts, one without `findVersions`, keeps the plain Save.
  const plain = await render(createElement(Form, { kayan: courses, client: draftClient(calls), value: draftRow, t, locale: 'en', onDone: () => {} }))
  assert.ok(buttonNamed(plain, 'Save'))
  assert.ok(!buttonNamed(plain, 'Save draft'))
  assert.ok(!publishOf(plain))
})

test('132b. a publish the server refuses draws its sentence under the box it names, as a save does', async () => {
  const refusal = Object.assign(new Error('Bad Request'), { status: 400, data: { key: 'error.invalid.value', params: { issues: [{ path: 'title', message: 'A published course needs a title.' }] } } })
  const client = draftClient([], async () => {
    throw refusal
  })
  const host = await render(createElement(Form, { kayan: courses, client, value: draftRow, t, locale: 'en', onDone: () => {}, drafts: { status: 'draft' } }))
  await act(async () => {
    click(publishOf(host)!)
  })
  const box = host.querySelector('#courses-title')!.closest('[data-slot="field"]') ?? host
  assert.ok(box.textContent?.includes('A published course needs a title.'), 'the refusal is drawn beside the title')
})

test('132c. the form says whether the row is a draft, published, or published with changes, the three statuses Payload draws', async () => {
  for (const [status, words] of [['draft', 'Draft'], ['published', 'Published'], ['changed', 'Changed']] as const) {
    const host = await render(createElement(Form, { kayan: courses, client: draftClient([]), value: draftRow, t, locale: 'en', onDone: () => {}, drafts: { status } }))
    assert.equal(host.querySelector('[data-status]')?.getAttribute('data-status'), status)
    assert.ok(host.querySelector('[data-status]')?.textContent?.includes(words), `a ${status} row reads ${words}`)
  }
  const plain = await render(createElement(Form, { kayan: courses, client: draftClient([]), value: draftRow, t, locale: 'en', onDone: () => {} }))
  assert.ok(!plain.querySelector('[data-status]'), 'and a form handed no drafts says nothing of them')
})

test('132d. an edit autosaves a draft once the form has stayed still for the interval, never while a save is in flight, and never again after a refusal until the next change', async () => {
  // The interval and its margins are five times larger than the property under test needs: a 15 ms margin against a 40 ms interval flaked under load, since scheduler jitter is a few milliseconds whatever the interval.
  const calls: DraftCall[] = []
  let answer: (call: DraftCall) => Promise<unknown> = async () => ({})
  const host = await render(createElement(Form, { kayan: courses, client: draftClient(calls, (call) => answer(call)), value: draftRow, t, locale: 'en', onDone: () => {}, drafts: { status: 'published', autosave: 200 } }))
  const title = () => host.querySelector('#courses-title')!
  await act(async () => {
    typeInto(title(), 'Tajweed I')
  })
  await act(async () => sleep(75))
  await act(async () => {
    typeInto(title(), 'Tajweed II')
  })
  await act(async () => sleep(125))
  assert.deepEqual(calls, [], 'a form still changing within the interval saves nothing')
  await act(async () => sleep(200))
  assert.deepEqual(calls, [{ operation: 'update', input: { title: 'Tajweed II', id: 'a-row' }, options: { draft: true, autosave: true } }], 'still for the interval, it saves a draft with the autosave word')
  assert.ok(host.querySelector('[data-autosave]')?.textContent?.includes('Saved'), 'and says it saved')
  assert.equal(host.querySelector('[data-status]')?.getAttribute('data-status'), 'changed', 'the published row now has changes pending')
  await act(async () => sleep(300))
  assert.equal(calls.length, 1, 'nothing more is saved while nothing changes')

  // In flight: a change made while the autosave is out is not saved beside it.
  let release: () => void = () => {}
  answer = () => new Promise((resolve) => (release = () => resolve({})))
  await act(async () => {
    typeInto(title(), 'Tajweed III')
  })
  await act(async () => sleep(300))
  assert.equal(calls.length, 2, 'the next change autosaves')
  assert.ok(host.querySelector('[data-autosave]')?.textContent?.includes('Saving'), 'saying so while it is out')
  await act(async () => {
    typeInto(title(), 'Tajweed IV')
  })
  await act(async () => sleep(300))
  assert.equal(calls.length, 2, 'and none starts while it is in flight')
  answer = async () => ({})
  await act(async () => release())
  await act(async () => sleep(300))
  assert.deepEqual(calls.at(-1), { operation: 'update', input: { title: 'Tajweed IV', id: 'a-row' }, options: { draft: true, autosave: true } }, 'once it lands, the change made meanwhile is saved')

  // A refusal: no retry of the same values, and the next change saves again.
  const refused = calls.length
  answer = async () => {
    throw Object.assign(new Error('Bad Request'), { status: 400, data: { key: 'error.invalid.value', params: { issues: [{ path: 'fee', message: 'A fee is a number.' }] } } })
  }
  await act(async () => {
    typeInto(title(), 'Tajweed V')
  })
  await act(async () => sleep(300))
  assert.equal(calls.length, refused + 1, 'the refused autosave was asked once')
  await act(async () => sleep(500))
  assert.equal(calls.length, refused + 1, 'and is not asked again over the same values')
  answer = async () => ({})
  await act(async () => {
    typeInto(title(), 'Tajweed VI')
  })
  await act(async () => sleep(300))
  assert.equal(calls.length, refused + 2, 'the next change autosaves again')
})

test('132e. a field typed back to what the row was loaded with is still saved once an autosave put another value in the draft', async () => {
  // The draft holds what the autosave sent, so a field returned to its loaded value differs from the draft and is sent; otherwise publishing would carry the autosaved value.
  const calls: DraftCall[] = []
  let release: () => void = () => {}
  let answer: () => Promise<unknown> = () => new Promise((resolve) => (release = () => resolve({})))
  const host = await render(createElement(Form, { kayan: courses, client: draftClient(calls, () => answer()), value: draftRow, t, locale: 'en', onDone: () => {}, drafts: { status: 'published', autosave: 30 } }))
  const title = () => host.querySelector('#courses-title')!
  await act(async () => {
    typeInto(title(), 'Tajweed II')
  })
  await act(async () => sleep(50))
  await act(async () => {
    typeInto(title(), 'Tajweed')
  })
  answer = async () => ({})
  await act(async () => release())
  await act(async () => sleep(50))
  assert.deepEqual(calls.map((one) => one.input.title), ['Tajweed II', 'Tajweed'], 'the title the draft no longer holds is autosaved back')
  await act(async () => {
    click(publishOf(host)!)
  })
  assert.deepEqual(calls.at(-1), { operation: 'update', input: { id: 'a-row' } }, 'and Publish then sends what differs from the draft, which is nothing')
})

const history = [
  { id: 'v5', latest: true, autosave: false, updatedAt: '2031-01-05T10:00:00.000Z', version: { title: 'Fifth', fee: 5, name: { ar: 'خامس', en: 'Fifth' }, _status: 'draft' } },
  { id: 'v4', latest: false, autosave: false, updatedAt: '2031-01-04T10:00:00.000Z', version: { title: 'Fourth', fee: 4, name: { ar: 'رابع', en: 'Fourth' }, _status: 'published' } },
  { id: 'v3', latest: false, autosave: true, updatedAt: '2031-01-03T10:00:00.000Z', version: { title: 'Third', fee: 2, name: { ar: 'ثان', en: 'Third' }, _status: 'draft' } },
  { id: 'v2', latest: false, autosave: false, updatedAt: '2031-01-02T10:00:00.000Z', version: { title: 'Second', fee: 2, name: { ar: 'ثان', en: 'Second' }, _status: 'draft' } },
  { id: 'v1', latest: false, autosave: false, updatedAt: '2031-01-01T10:00:00.000Z', version: { title: 'First', fee: 1, name: { ar: 'أول', en: 'First' }, _status: 'published' } },
]
const versioned = { ...courses, fields: [...courses.fields, fieldOf({ name: 'name', kind: 'text', label: { en: 'Name', ar: 'الاسم' }, rules: { localized: true } })] }
type Asked = { operation: string; input: Record<string, unknown>; options?: unknown }
/** Answers `rows`, and `history` unless a step hands its own; a version by id is never asked for. */
const historyClient = (asked: Asked[], restore: () => Promise<unknown> = async () => ({}), rows: readonly { id: string; updatedAt: string }[] = history) =>
  async ({ kayan: _kayan, operation, input, ...options }: { kayan: string; operation: string; input: Record<string, unknown>; draft?: boolean; autosave?: boolean }) => {
    asked.push({ operation, input, ...(Object.keys(options).length && { options }) })
    if (operation === 'restoreVersion') return restore()
    if (input.limit === 1) {
      const before = ((input.where as { and: [unknown, { updatedAt: { less_than: string } }] }).and[1]).updatedAt.less_than
      return { docs: rows.filter((one) => one.updatedAt < before).slice(0, 1), hasNextPage: false }
    }
    return { docs: rows, hasNextPage: false }
  }
const versionRecord = { id: 'a-row', updatedAt: '2031-01-05T10:00:00.000Z' }
const reading = { collections: { courses: { operations: { findVersions: true } } } }
const restoring = { collections: { courses: { operations: { findVersions: true, restoreVersion: true } } } }
const sheet = () => window.document.querySelector('[data-slot="sheet-content"]') as unknown as Element | null
const openVersion = async (host: HTMLElement, id: string) => {
  await act(async () => {
    click(host.querySelector(`[data-version="${id}"] [data-button="open-version"]`)!)
  })
  await act(async () => sleep(0))
}
const diffRows = () => [...(sheet()?.querySelectorAll('[data-diff]') ?? [])].map((one) => one.getAttribute('data-diff'))

test('171g. the versions list labels each version as Payload does, with its autosave, and offers no latest badge and no restore', async () => {
  const { Versions } = await import('../../../templates/asas/src/ui-dashboard/versions.tsx')
  const asked: Asked[] = []
  const host = await render(createElement(Versions, { page: undefined as never }), { client: historyClient(asked), record: versionRecord, access: restoring, kayan: versioned })
  await act(async () => sleep(0))
  assert.deepEqual(asked[0], { operation: 'findVersions', input: { where: { parent: { equals: 'a-row' } }, sort: '-updatedAt', limit: 10 } }, 'it reads this row\'s versions, newest first')
  const rows = [...host.querySelectorAll('[data-version]')]
  const labels = ['Current draft', 'Currently published', 'Previously published', 'Draft']
  assert.deepEqual(rows.map((row) => labels.find((label) => row.textContent?.includes(label))), ['Current draft', 'Currently published', 'Draft', 'Draft', 'Previously published'])
  assert.deepEqual(rows.map((row) => row.textContent?.includes('Autosave')), [false, false, true, false, false], 'the autosave is badged')
  assert.equal(rows.filter((row) => row.querySelector('[data-button="open-version"]')).length, 5, 'each opens by its moment')
  assert.equal(host.textContent?.includes('Latest'), false, 'no latest badge')
  assert.equal(host.querySelectorAll('[data-button="restore"]').length, 0, 'and no restore in the list')
})

test('171h. a version opens Compare versions against the previous one, modified only, a localized field a row per locale, and a select picks another to compare against', async () => {
  const { Versions } = await import('../../../templates/asas/src/ui-dashboard/versions.tsx')
  const asked: Asked[] = []
  const host = await render(createElement(Versions, { page: undefined as never }), { client: historyClient(asked), record: versionRecord, access: reading, kayan: versioned })
  await act(async () => sleep(0))
  await openVersion(host, 'v3')
  assert.equal(sheet()?.textContent?.includes('Compare versions'), true, 'a sheet titled Compare versions opens')
  assert.deepEqual(asked.slice(1), [
    { operation: 'findVersions', input: { where: { and: [{ parent: { equals: 'a-row' } }, { updatedAt: { less_than: '2031-01-03T10:00:00.000Z' } }] }, sort: '-updatedAt', limit: 1 } },
  ], 'it reads the one before the version, which the list already holds itself')
  assert.deepEqual(diffRows(), ['title', 'name.en'], 'modified only: the title and the one locale that changed')
  assert.equal(sheet()?.textContent?.includes('Second') && sheet()?.textContent?.includes('Third'), true, 'each drawn on its side')

  await act(async () => {
    click(sheet()!.querySelector('[data-modified-only]')!)
  })
  assert.deepEqual(diffRows(), ['title', 'fee', 'name.ar', 'name.en'], 'every field either holds, each locale its own row')
  await act(async () => {
    click(sheet()!.querySelector('[data-modified-only]')!)
  })
  assert.deepEqual(diffRows(), ['title', 'name.en'], 'and modified only again')

  await act(async () => {
    click(sheet()!.querySelector('[data-slot="select-trigger"]')!)
  })
  const options = [...window.document.querySelectorAll('[data-slot="select-item"]')]
  assert.deepEqual(
    ['Previous version', 'Current draft', 'Currently published', 'Previously published'].map((label) => options.some((one) => one.textContent?.includes(label))),
    [true, true, true, true],
    'the previous version, the current draft, the currently published copy and every other version are offered',
  )
  assert.equal(options.length, 4, 'the previous version once, under that name alone, and every other version but the one being compared')
  assert.equal(options.some((one) => /\bDraft\b/.test(one.textContent ?? '')), false, 'the previous version, v2, the only plain draft here, is not offered again under its own date')
  const reads = asked.length
  await act(async () => {
    click(options.find((one) => one.textContent?.includes('Currently published')) as unknown as Element)
  })
  await act(async () => sleep(0))
  assert.equal(asked.length, reads, 'picking one asks for nothing, the list holds it')
  assert.deepEqual(diffRows(), ['title', 'fee', 'name.ar', 'name.en'], 'and the diff is against it, where every field differs')
})

test('171j. a field empty on both sides is no change, as the activity panel reads it, and all fields still lists it', async () => {
  const { Versions } = await import('../../../templates/asas/src/ui-dashboard/versions.tsx')
  const rows = [
    { id: 'b', latest: true, autosave: false, updatedAt: '2031-02-02T10:00:00.000Z', version: { title: 'Same', fee: 2, summary: null, _status: 'published' } },
    { id: 'a', latest: false, autosave: false, updatedAt: '2031-02-01T10:00:00.000Z', version: { title: 'Same', fee: 1, summary: '', _status: 'published' } },
  ]
  const host = await render(createElement(Versions, { page: undefined as never }), { client: historyClient([], undefined, rows), record: versionRecord, access: reading, kayan: versioned })
  await act(async () => sleep(0))
  await openVersion(host, 'b')
  assert.deepEqual(diffRows(), ['fee'], 'modified only: an empty string and a null are the one change nobody sees')
  await act(async () => {
    click(sheet()!.querySelector('[data-modified-only]')!)
  })
  assert.deepEqual(diffRows(), ['title', 'summary', 'fee'], 'and every field lists it')
})

test('171k. a reader who may not read the status sees no pill and no Restore as draft, and still restores', async () => {
  // Field access cuts `_status` from a version like any other column.
  const { Versions } = await import('../../../templates/asas/src/ui-dashboard/versions.tsx')
  const cut = history.map(({ version: { _status, ...kept }, ...one }) => ({ ...one, version: kept }))
  const host = await render(createElement(Versions, { page: undefined as never }), { client: historyClient([], undefined, cut), record: versionRecord, access: restoring, kayan: versioned })
  await act(async () => sleep(0))
  const pills = ['Current draft', 'Currently published', 'Previously published', 'Draft']
  const rows = [...host.querySelectorAll('[data-version]')]
  assert.deepEqual(rows.map((row) => pills.some((label) => row.textContent?.includes(label))), [false, false, false, false, false], 'no row says what it cannot know')
  assert.deepEqual(rows.map((row) => row.textContent?.includes('Autosave')), [false, false, true, false, false], 'the autosave is still badged')
  await openVersion(host, 'v1')
  assert.equal(pills.some((label) => sheet()?.textContent?.includes(label)), false, 'nor does the sheet, in its header or its select')
  assert.deepEqual([!!sheet()?.querySelector('[data-button="restore"]'), !!sheet()?.querySelector('[data-button="restore-as-draft"]')], [true, false], 'a restore onto the row, and none as a draft')
})

test('171i. the sheet restores behind a confirm, as a draft only for a version that is not one, never without restoreVersion, and keeps a refusal on screen', async () => {
  const { Versions } = await import('../../../templates/asas/src/ui-dashboard/versions.tsx')
  const reloads: number[] = []
  const reload = window.location.reload
  Object.defineProperty(window.location, 'reload', { configurable: true, value: () => reloads.push(1) })
  const confirm = async () => {
    const dialog = window.document.querySelector('[data-slot="alert-dialog-content"]')
    assert.equal(dialog?.textContent?.includes('Confirm version restoration'), true, 'it asks first')
    await act(async () => {
      click(dialog!.querySelector('[data-button="confirm-restore"]') as unknown as Element)
    })
    await act(async () => sleep(0))
  }
  try {
    const asked: Asked[] = []
    const host = await render(createElement(Versions, { page: undefined as never }), { client: historyClient(asked), record: versionRecord, access: restoring, kayan: versioned })
    await act(async () => sleep(0))
    await openVersion(host, 'v3')
    assert.deepEqual([!!sheet()?.querySelector('[data-button="restore"]'), !!sheet()?.querySelector('[data-button="restore-as-draft"]')], [true, false], 'a draft is restored, never as a draft')
    await openVersion(host, 'v1')
    assert.deepEqual([!!sheet()?.querySelector('[data-button="restore"]'), !!sheet()?.querySelector('[data-button="restore-as-draft"]')], [true, true], 'a published version may be restored as a draft too')
    await act(async () => {
      click(sheet()!.querySelector('[data-button="restore-as-draft"]')!)
    })
    assert.equal(asked.some((one) => one.operation === 'restoreVersion'), false, 'one press restores nothing')
    await confirm()
    assert.deepEqual(asked.at(-1), { operation: 'restoreVersion', input: { id: 'v1' }, options: { draft: true } }, 'the confirm restores it as a draft')
    assert.deepEqual(reloads, [1], 'and the page is read again')
    const again = await render(createElement(Versions, { page: undefined as never }), { client: historyClient(asked), record: versionRecord, access: restoring, kayan: versioned })
    await act(async () => sleep(0))
    await openVersion(again, 'v1')
    await act(async () => {
      click(sheet()!.querySelector('[data-button="restore"]')!)
    })
    await confirm()
    assert.deepEqual(asked.at(-1), { operation: 'restoreVersion', input: { id: 'v1' }, options: { draft: false } }, 'Restore restores onto the row')
    assert.deepEqual(reloads, [1, 1])

    const viewer = await render(createElement(Versions, { page: undefined as never }), { client: historyClient([]), record: versionRecord, access: reading, kayan: versioned })
    await act(async () => sleep(0))
    await openVersion(viewer, 'v1')
    assert.equal(!!sheet()?.querySelector('[data-button="restore"]') || !!sheet()?.querySelector('[data-button="restore-as-draft"]'), false, 'no restore without restoreVersion')

    const refusal = Object.assign(new Error('Conflict'), { status: 409, data: { key: 'error.versionChanged' } })
    const failed = await render(createElement(Versions, { page: undefined as never }), { client: historyClient([], async () => { throw refusal }), record: versionRecord, access: restoring, kayan: versioned })
    await act(async () => sleep(0))
    await openVersion(failed, 'v1')
    await act(async () => {
      click(sheet()!.querySelector('[data-button="restore"]')!)
    })
    await confirm()
    assert.deepEqual(reloads, [1, 1], 'a refused restore never reloads')
    assert.equal(sheet()?.textContent?.includes('Compare versions'), true, 'the sheet stays open')
    assert.equal(sheet()?.textContent?.includes('There was a problem restoring this version'), true, 'with Payload\'s sentence')
    assert.equal(sheet()?.textContent?.includes('error.versionChanged'), true, 'and the server\'s own beside it')
    assert.equal((sheet()?.querySelector('[data-button="restore"]') as HTMLButtonElement | null)?.disabled, false, 'and restore can be tried again')
  } finally {
    Object.defineProperty(window.location, 'reload', { configurable: true, value: reload })
  }
})

test('171l. Restore as draft goes through the host\'s own arm, and the request it makes is the plug\'s draft route', async () => {
  // Nothing here is a client of the test's: the arm is the browser's, over a `fetch` that records what it is asked, so what is held is the URL the fetch plug reads the draft word off.
  const { Versions } = await import('../../../templates/asas/src/ui-dashboard/versions.tsx')
  const urls: string[] = []
  const own = globalThis.fetch
  globalThis.fetch = (async (input: string) => {
    urls.push(String(input))
    return Response.json(String(input).endsWith('/findVersions') ? { docs: history, hasNextPage: false } : {})
  }) as typeof fetch
  const reload = window.location.reload
  Object.defineProperty(window.location, 'reload', { configurable: true, value: () => {} })
  try {
    const host = await render(createElement(Versions, { page: undefined as never }), { client: clientOf(arm), record: versionRecord, access: restoring, kayan: versioned })
    await act(async () => sleep(0))
    await openVersion(host, 'v1')
    await act(async () => {
      click(sheet()!.querySelector('[data-button="restore-as-draft"]')!)
    })
    await act(async () => {
      click(window.document.querySelector('[data-slot="alert-dialog-content"] [data-button="confirm-restore"]') as unknown as Element)
    })
    await act(async () => sleep(0))
    assert.equal(urls.at(-1)?.endsWith('restoreVersion?draft=true'), true, `the last request is ${urls.at(-1)}`)
  } finally {
    globalThis.fetch = own
    Object.defineProperty(window.location, 'reload', { configurable: true, value: reload })
  }
})

test('171m. a loader that passes an actor of its own through options still runs as the request\'s actor, and the draft words get through', async () => {
  // The server's `client` runs operations in process, where `options.actor` is who the operation runs as, so a caller's own `actor` must never win.
  const { actingAs } = await import('../registry/host/api.ts')
  const seen: { actor?: unknown; draft?: unknown; autosave?: unknown; other?: unknown }[] = []
  const operations = { find: async (_input: object, options: { actor?: unknown; draft?: boolean; autosave?: boolean }) => void seen.push(options) }
  const client = actingAs({ courses: { operations } }, 'the-real-actor')
  await client({ kayan: 'courses', operation: 'find', input: {}, actor: 'someone-else', draft: true, autosave: true, other: 'x' } as never)
  await client({ kayan: 'courses', operation: 'find', input: {} })
  assert.deepEqual(seen.map((one) => one.actor), ['the-real-actor', 'the-real-actor'], 'the actor is the request\'s, whatever the options say')
  assert.deepEqual([seen[0]!.draft, seen[0]!.autosave, 'other' in seen[0]!], [true, true, false], 'the two draft words ride along and nothing else does')
})

test('215g. the host reads whether an operation takes expectedUpdatedAt off its input: tags\' update and courses\' update, delete and restore do, sessions\' update and tags\' delete do not', async () => {
  const { takesKey } = await import('../registry/host/api.ts')
  const { asas } = await import('../../../templates/asas/src/asas.ts')
  const input = (kayan: string, name = 'update') => asas.operations.find((one) => one.kayan === kayan && one.name === name)!.input
  const update = (kayan: string) => input(kayan)
  assert.equal(takesKey(update('tags'), 'expectedUpdatedAt'), true, 'tags lists the step and widens its input')
  assert.equal(takesKey(update('courses'), 'expectedUpdatedAt'), true, 'courses keeps drafts and does too')
  assert.equal(takesKey(input('courses', 'delete'), 'expectedUpdatedAt'), true, 'and so does its delete')
  assert.equal(takesKey(input('courses', 'restoreVersion'), 'expectedUpdatedAt'), true, 'and its restore')
  assert.equal(takesKey(update('sessions'), 'expectedUpdatedAt'), false, 'sessions does neither')
  assert.equal(takesKey(input('tags', 'delete'), 'expectedUpdatedAt'), false, 'nor does tags\' delete')
  assert.equal(takesKey(update('tags'), 'title'), false, 'and a key the update does not name is not read as taken')
  assert.equal(takesKey({ '~standard': { validate: () => { throw new Error('a schema that throws') } } }, 'expectedUpdatedAt'), false, 'and a schema that throws is read as naming nothing')
})

test('171n. every screen client goes through clientOf, and none is a lambda of its own', () => {
  // `useScreenState` cannot be mounted under node, so this reads the host's source: the browser loader and `useScreenState` take `clientOf`, so a draft word is never dropped.
  const lines = readFileSync(new URL('../registry/host/screens.tsx', import.meta.url), 'utf8').split('\n')
  assert.equal(lines.filter((line) => line.includes('client: ({ kayan, operation, input }) =>')).length, 0, 'no hand-written client')
  assert.deepEqual(
    ['client: clientOf(arm), request', 'client: clientOf(arm) }'].map((one) => lines.some((line) => line.includes(one))),
    [true, true],
    'the browser loader and useScreenState go through clientOf',
  )
})

test('171o. a failed read of the previous version draws no failure once another version is picked, and the diff is against it', async () => {
  const { Versions } = await import('../../../templates/asas/src/ui-dashboard/versions.tsx')
  const asked: Asked[] = []
  const answer = historyClient(asked)
  const failing = async (call: { kayan: string; operation: string; input: Record<string, unknown>; draft?: boolean; autosave?: boolean }) => {
    if (call.input.limit === 1) throw new Error('down')
    return answer(call)
  }
  const host = await render(createElement(Versions, { page: undefined as never }), { client: failing, record: versionRecord, access: reading, kayan: versioned })
  await act(async () => sleep(0))
  await openVersion(host, 'v3')
  assert.equal(!!sheet()?.querySelector('[role="alert"]'), true, 'with nothing picked the failure is drawn')
  await act(async () => {
    click(sheet()!.querySelector('[data-slot="select-trigger"]')!)
  })
  await act(async () => {
    click([...window.document.querySelectorAll('[data-slot="select-item"]')].find((one) => one.textContent?.includes('Currently published')) as unknown as Element)
  })
  await act(async () => sleep(0))
  assert.equal(!!sheet()?.querySelector('[role="alert"]'), false, 'a picked version is in the list, so no failure is drawn')
  assert.deepEqual(diffRows(), ['title', 'fee', 'name.ar', 'name.en'], 'and the diff is against it')
})

test('171p. the previous version is never offered before it is known, so a pick is never removed once it loads', async () => {
  const { Versions } = await import('../../../templates/asas/src/ui-dashboard/versions.tsx')
  const answer = historyClient([])
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => (release = resolve))
  const slow = async (call: { kayan: string; operation: string; input: Record<string, unknown>; draft?: boolean; autosave?: boolean }) => {
    if (call.input.limit === 1) await held
    return answer(call)
  }
  const host = await render(createElement(Versions, { page: undefined as never }), { client: slow, record: versionRecord, access: reading, kayan: versioned })
  await act(async () => sleep(0))
  await openVersion(host, 'v3')
  const items = () => window.document.querySelectorAll('[data-slot="select-item"]').length
  const trigger = () => sheet()!.querySelector('[data-slot="select-trigger"]')
  await act(async () => {
    if (trigger()) click(trigger()!)
  })
  assert.equal(items(), 0, 'while the previous version is unread nothing can be picked')
  await act(async () => release())
  await act(async () => sleep(0))
  await act(async () => {
    click(trigger()!)
  })
  assert.equal(items(), 4, 'once it is read the select offers the previous version once and every other')
})

test('132g. a field-less refusal is said once in a toast and leaves no banner over the form, and a later autosave still lands', async () => {
  // A save refused with no field named (a conflict, not a bad value) is the toast's to say, so no banner sits over a row a later autosave saved.
  await toasted()
  const calls: DraftCall[] = []
  let answer: (call: DraftCall) => Promise<unknown> = async () => {
    throw Object.assign(new Error('Conflict'), { status: 409, data: { key: 'error.rowChanged' } })
  }
  const host = await render(withToaster(createElement(Form, { kayan: courses, client: draftClient(calls, (call) => answer(call)), value: draftRow, t, locale: 'en', onDone: () => {}, drafts: { status: 'published', autosave: 200 } })))
  const title = () => host.querySelector('#courses-title')!
  await act(async () => {
    typeInto(title(), 'Tajweed I')
  })
  await act(async () => {
    click(publishOf(host)!)
  })
  assert.deepEqual(await toasted(), ['error: Something went wrong, so nothing was saved. Try again.'], 'the refusal is a toast, naming no field')
  assert.ok(!host.querySelector('[role="alert"]'), 'and no banner')
  answer = async () => ({})
  await act(async () => {
    typeInto(title(), 'Tajweed II')
  })
  await act(async () => sleep(300))
  assert.ok(host.querySelector('[data-autosave]')?.textContent?.includes('Saved'), 'the autosave that follows lands')
  assert.ok(!host.querySelector('[role="alert"]'), 'and no banner came back')
})

test('132h. the versions panel re-reads once a save lands, an autosave included, since a draft save never moves the row\'s own updatedAt', async () => {
  // The panel reads the counter the form bumps on every save through `FormContext`, handed down as the host hands a component the form it sits in.
  const { Versions } = await import('../../../templates/asas/src/ui-dashboard/versions.tsx')
  const calls: string[] = []
  const client = async ({ operation }: { operation: string }) => {
    calls.push(operation)
    return { docs: [], hasNextPage: false }
  }
  const record = { id: 'a-row', updatedAt: '2031-01-03T10:00:00.000Z' }
  const access = { collections: { courses: { operations: { findVersions: true } } } }
  const host = mount()
  const root = createRoot(host)
  const tree = (saves: number) =>
    createElement(
      ScreenContext,
      { value: { ...state, client, record, access } },
      createElement(FormContext, { value: { getData: () => ({}), setValue: () => {}, disabled: false, saves } }, createElement(Versions, { page: undefined as never })),
    )
  try {
    await act(async () => root.render(tree(0)))
    await act(async () => sleep(0))
    assert.equal(calls.length, 1, 'it reads the row\'s versions once on mount')
    await act(async () => root.render(tree(0)))
    await act(async () => sleep(0))
    assert.equal(calls.length, 1, 'and not again while neither the row nor the save count moved')
    await act(async () => root.render(tree(1)))
    await act(async () => sleep(0))
    assert.equal(calls.length, 2, 'a save landing, an autosave among them, bumps the count and the panel reads its versions again')
  } finally {
    await act(async () => root.unmount())
  }
})

const publishedClient = (calls: DraftCall[], asked: Asked[], answer?: (call: DraftCall) => Promise<unknown>) => ({
  ...draftClient(calls, answer),
  findByID: async (input: Record<string, unknown>) => {
    asked.push({ operation: 'findByID', input })
    return { ...draftRow, title: 'Published title', fee: 250 }
  },
  run: async (operation: string, input: Record<string, unknown>) => {
    asked.push({ operation, input })
    return { ...draftRow, title: 'Published title', fee: 250 }
  },
})
const toggleNamed = (host: HTMLElement, words: string) =>
  [...host.querySelectorAll('[data-view-switch] button')].find((one) => one.textContent?.trim() === words) as HTMLButtonElement | undefined

test('172d. an autosave that lands says Saved with a check in the success colour for about two seconds, then goes', async () => {
  const calls: DraftCall[] = []
  const host = await render(createElement(Form, { kayan: courses, screen: screenOf(courses.pages.edit!), client: draftClient(calls), value: draftRow, t, locale: 'en', onDone: () => {}, drafts: { status: 'published', autosave: 50 } }), { record: draftRow })
  await act(async () => {
    typeInto(host.querySelector('#courses-title')!, 'Tajweed I')
  })
  await act(async () => sleep(150))
  const note = () => host.querySelector('[data-node="controls"] [data-autosave]')
  assert.equal(calls.length, 1, 'the autosave ran')
  assert.equal(note()?.getAttribute('data-autosave'), 'saved')
  assert.equal(note()?.textContent?.trim(), 'Saved')
  assert.equal(!!note()?.querySelector('svg'), true, 'with a check')
  assert.equal(note()?.className.includes('text-emerald'), true, 'in the success colour')
  assert.equal(note()?.className.includes('fade-out'), true, 'fading as it ends')
  await act(async () => sleep(2100))
  assert.equal(!!note(), false, 'and after about two seconds it is gone')
})

test('172e. the status pill is coloured by status, always with its word, and shows on a phone', async () => {
  for (const [status, words, colour] of [['draft', 'Draft', 'bg-muted'], ['published', 'Published', 'bg-emerald-500/15'], ['changed', 'Changed', 'bg-amber-500/15']] as const) {
    const host = await render(createElement(Form, { kayan: courses, screen: screenOf(courses.pages.edit!), client: draftClient([]), value: draftRow, t, locale: 'en', onDone: () => {}, drafts: { status } }), { record: draftRow })
    const pill = host.querySelector('[data-node="controls"] [data-status]')
    assert.equal(pill?.textContent?.trim(), words, `a ${status} row reads ${words}`)
    assert.equal(pill?.className.split(' ').includes(colour), true, `in ${colour}`)
    assert.equal(pill?.classList.contains('hidden'), false, 'and is not hidden on a phone')
  }
})

test('172f. a Draft and Published switch shows only on a changed row; Published is the plain read, read only and with no save, and Draft again keeps what was typed', async () => {
  for (const status of ['draft', 'published'] as const) {
    const host = await render(createElement(Form, { kayan: courses, screen: screenOf(courses.pages.edit!), client: publishedClient([], []), value: draftRow, t, locale: 'en', onDone: () => {}, drafts: { status } }), { record: draftRow })
    assert.equal(!!host.querySelector('[data-view-switch]'), false, `no switch on a ${status} row`)
  }
  const calls: DraftCall[] = []
  const asked: Asked[] = []
  const host = await render(createElement(Form, { kayan: courses, screen: screenOf(courses.pages.edit!), client: publishedClient(calls, asked), value: draftRow, t, locale: 'en', onDone: () => {}, onCancel: () => {}, drafts: { status: 'changed' } }), { record: draftRow })
  const title = () => host.querySelector('#courses-title') as HTMLInputElement
  assert.equal(!!host.querySelector('[data-node="controls"] [data-view-switch]'), true, 'the switch sits in the header on a changed row')
  assert.equal(toggleNamed(host, 'Draft')?.getAttribute('aria-pressed'), 'true', 'on Draft by default')
  assert.equal(asked.length, 0, 'and nothing is read before Published is chosen')
  await act(async () => {
    typeInto(title(), 'Edited')
  })
  await act(async () => {
    click(toggleNamed(host, 'Published')!)
  })
  await act(async () => sleep(0))
  assert.deepEqual(asked, [{ operation: 'findByID', input: { id: 'a-row' } }], 'Published reads the row once, without the draft word')
  assert.equal(title().value, 'Published title', 'and shows the published copy')
  assert.equal([...host.querySelectorAll('input, textarea')].every((one) => (one as HTMLInputElement).disabled), true, 'with every control disabled')
  assert.deepEqual([!!publishOf(host), !!buttonNamed(host, 'Save draft')], [false, false], 'and no Publish or Save draft')
  await act(async () => {
    click(toggleNamed(host, 'Draft')!)
  })
  assert.equal(title().value, 'Edited', 'Draft again keeps the edit nobody saved')
  assert.equal(title().disabled, false)
  assert.equal(!!publishOf(host), true)
  await act(async () => {
    click(toggleNamed(host, 'Published')!)
  })
  assert.equal(asked.length, 1, 'the published copy is read only the first time')
  assert.equal(calls.length, 0, 'and nothing was written')

  const autosaving: DraftCall[] = []
  const shown = await render(createElement(Form, { kayan: courses, screen: screenOf(courses.pages.edit!), client: publishedClient(autosaving, []), value: draftRow, t, locale: 'en', onDone: () => {}, drafts: { status: 'changed', autosave: 100 } }), { record: draftRow })
  await act(async () => {
    typeInto(shown.querySelector('#courses-title')!, 'Edited')
  })
  await act(async () => {
    click(toggleNamed(shown, 'Published')!)
  })
  await act(async () => sleep(250))
  assert.equal(autosaving.length, 0, 'the published copy autosaves nothing')
  await act(async () => {
    click(toggleNamed(shown, 'Draft')!)
  })
  await act(async () => sleep(250))
  assert.deepEqual(autosaving.map((one) => [one.operation, one.input.title]), [['update', 'Edited']], 'and the draft autosaves its edit once it is back')
})

test('172g. a changed row draws the draft banner with View published and Discard changes, the published copy a read-only strip, and Discard changes reverts to published behind Payload\'s confirm', async () => {
  const asked: Asked[] = []
  const landed: (string | undefined)[] = []
  const host = await render(createElement(Form, { kayan: courses, screen: screenOf(courses.pages.edit!), client: publishedClient([], asked), value: draftRow, t, locale: 'en', onDone: (_row: unknown, effect?: string) => landed.push(effect), operations: { restoreVersion: true }, drafts: { status: 'changed' } }), { record: draftRow })
  const banner = () => host.querySelector('[data-draft-banner]')
  assert.equal(banner()?.getAttribute('data-draft-banner'), 'draft')
  assert.equal(banner()?.textContent?.includes('You are editing a draft. The published version is different.'), true)
  assert.equal(banner()?.className.includes('amber'), true, 'in amber')
  assert.deepEqual([!!buttonNamed(host, 'View published'), !!buttonNamed(host, 'Discard changes')], [true, true])

  await act(async () => {
    click(buttonNamed(host, 'Discard changes')!)
  })
  const dialog = () => window.document.querySelector('[data-slot="alert-dialog-content"]') as unknown as Element | null
  assert.equal(dialog()?.textContent?.includes('Confirm revert to saved'), true, 'it asks first, in Payload\'s words')
  assert.equal(dialog()?.textContent?.includes('You are about to revert this document\'s changes to its published state. Are you sure?'), true)
  assert.equal(asked.length, 0, 'and nothing runs before the confirm')
  await act(async () => {
    click(dialog()!.querySelector('[data-button="confirm-discard-draft"]')!)
  })
  assert.deepEqual(asked, [{ operation: 'restoreVersion', input: { id: 'a-row' } }], 'the confirm restores the row\'s own published copy')
  assert.deepEqual(landed, ['update'], 'and the host reads the row again')

  asked.length = 0
  const viewing = await render(createElement(Form, { kayan: courses, screen: screenOf(courses.pages.edit!), client: publishedClient([], asked), value: draftRow, t, locale: 'en', onDone: () => {}, operations: {}, drafts: { status: 'changed' } }), { record: draftRow })
  assert.equal(!!buttonNamed(viewing, 'Discard changes'), false, 'no Discard changes without restoreVersion')
  await act(async () => {
    click(buttonNamed(viewing, 'View published')!)
  })
  await act(async () => sleep(0))
  assert.equal(toggleNamed(viewing, 'Published')?.getAttribute('aria-pressed'), 'true', 'View published flips the switch')
  const strip = viewing.querySelector('[data-draft-banner]')
  assert.equal(strip?.getAttribute('data-draft-banner'), 'published')
  assert.equal(strip?.textContent?.trim(), 'Read only. This is the published version.')
  assert.equal(strip?.className.includes('amber'), false, 'a neutral strip')

  const published = await render(createElement(Form, { kayan: courses, screen: screenOf(courses.pages.edit!), client: publishedClient([], []), value: draftRow, t, locale: 'en', onDone: () => {}, drafts: { status: 'published' } }), { record: draftRow })
  assert.equal(!!published.querySelector('[data-draft-banner]'), false, 'a published row draws no banner')
})

function CreateHost({ client, drafts, leave }: { client: ReturnType<typeof draftClient>; drafts?: { autosave?: number }; leave?: { to?: () => void } }): ReactElement {
  const [row, setRow] = useState<Record<string, unknown> | null>(null)
  if (leave) leave.to = () => setRow(null)
  return createElement(Form, {
    kayan: courses,
    screen: screenOf(row ? courses.pages.edit! : courses.pages.create!),
    client,
    value: row,
    t,
    locale: 'en',
    onDone: (made: unknown, effect?: string) => effect === 'create' && setRow(made as Record<string, unknown>),
    ...(drafts && { drafts: row ? { status: 'draft' as const, ...drafts } : drafts }),
  })
}

test('172h. a create page autosaves a draft after the first change, moves to the new row\'s edit page keeping what was typed and where, then autosaves updates; no change makes no row, and an actor without the key keeps Save', async () => {
  const calls: DraftCall[] = []
  let release: () => void = () => {}
  let answer: (call: DraftCall) => Promise<unknown> = (call) => new Promise((resolve) => (release = () => resolve({ ...call.input, id: 'made-1', _status: 'draft' })))
  const host = await render(createElement(CreateHost, { client: draftClient(calls, (call) => answer(call)), drafts: { autosave: 100 } }))
  const title = () => host.querySelector('#courses-title') as HTMLInputElement
  assert.equal(!!buttonNamed(host, 'Save draft'), true, 'Save draft shows on a create that autosaves')
  // Mocked, so a loaded machine cannot stretch the 99ms before the interval past it.
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    await act(async () => mock.timers.tick(250))
    assert.equal(calls.length, 0, 'an untouched create page makes no row')
    await act(async () => {
      title().focus()
      typeInto(title(), 'Taj')
    })
    await act(async () => mock.timers.tick(99))
    assert.equal(calls.length, 0, 'nothing before the interval')
    await act(async () => mock.timers.tick(1))
  } finally {
    mock.timers.reset()
  }
  assert.deepEqual(calls.map((one) => [one.operation, one.input.title, JSON.stringify(one.options)]), [['create', 'Taj', '{"draft":true,"autosave":true}']], 'the first autosave creates the row as a draft')
  await act(async () => {
    typeInto(title(), 'Tajweed')
  })
  answer = async (call) => ({ ...call.input, _status: 'draft' })
  await act(async () => release())
  await act(async () => sleep(0))
  assert.equal(!!host.querySelector('[data-slot="tabs-list"]'), true, 'the page moved to the edit page')
  assert.equal(title().value, 'Tajweed', 'keeping what was typed while the create was out')
  assert.equal(window.document.activeElement?.id, 'courses-title', 'and the box being typed in')
  await act(async () => sleep(250))
  assert.deepEqual(calls.slice(1).map((one) => [one.operation, one.input.id, one.input.title]), [['update', 'made-1', 'Tajweed']], 'later autosaves update the row the first one made')

  const plain: DraftCall[] = []
  const keyless = await render(createElement(CreateHost, { client: draftClient(plain) }))
  assert.equal(!!buttonNamed(keyless, 'Save'), true, 'an actor without findVersions keeps the plain Save')
  assert.equal(!!buttonNamed(keyless, 'Save draft'), false, 'and gets no Save draft')
  await act(async () => {
    typeInto(keyless.querySelector('#courses-title')!, 'Plain')
  })
  await act(async () => sleep(250))
  assert.equal(plain.length, 0, 'and nothing is autosaved')
})

test('172i. a create page opened again after an autosave made a row makes a new row, never updating the one before', async () => {
  const calls: DraftCall[] = []
  const leave: { to?: () => void } = {}
  const host = await render(createElement(CreateHost, { client: draftClient(calls, async (call) => ({ ...call.input, id: call.input.id ?? 'made-1', _status: 'draft' })), drafts: { autosave: 50 }, leave }))
  await act(async () => {
    typeInto(host.querySelector('#courses-title')!, 'First')
  })
  await act(async () => sleep(150))
  assert.equal(!!host.querySelector('[data-slot="tabs-list"]'), true, 'the first create moved to its edit page')
  await act(async () => leave.to!())
  assert.equal((host.querySelector('#courses-title') as HTMLInputElement).value, '', 'the create page opens empty')
  await act(async () => {
    typeInto(host.querySelector('#courses-title')!, 'Second')
  })
  await act(async () => sleep(150))
  assert.deepEqual(calls.map((one) => [one.operation, one.input.title]), [['create', 'First'], ['create', 'Second']], 'the second create page makes its own row')
})

test('172j. Discard changes and its confirm wait while an autosave is out, so a landing autosave cannot undo the discard', async () => {
  const calls: DraftCall[] = []
  const asked: Asked[] = []
  let release: () => void = () => {}
  const host = await render(createElement(Form, {
    kayan: courses,
    screen: screenOf(courses.pages.edit!),
    client: publishedClient(calls, asked, () => new Promise((resolve) => (release = () => resolve({ ...draftRow, _status: 'draft' })))),
    value: draftRow,
    t,
    locale: 'en',
    onDone: () => {},
    operations: { restoreVersion: true },
    drafts: { status: 'changed', autosave: 50 },
  }), { record: draftRow })
  const confirm = () => window.document.querySelector('[data-button="confirm-discard-draft"]') as HTMLButtonElement | null
  await act(async () => {
    click(buttonNamed(host, 'Discard changes')!)
  })
  assert.deepEqual([buttonNamed(host, 'Discard changes')?.disabled, confirm()?.disabled], [false, false], 'both are offered while nothing is out')
  await act(async () => {
    typeInto(host.querySelector('#courses-title')!, 'Tajweed II')
  })
  await act(async () => sleep(150))
  assert.equal(calls.length, 1, 'the autosave is out')
  assert.deepEqual([buttonNamed(host, 'Discard changes')?.disabled, confirm()?.disabled], [true, true], 'and the trigger and the confirm wait for it, as Publish does')
  await act(async () => release())
  await act(async () => sleep(0))
  assert.equal(confirm()?.disabled, false, 'and the confirm is offered again once it landed')
})

test('172k. a create autosave that lands after the form went away makes no move to the edit page', async () => {
  const calls: DraftCall[] = []
  const landed: (string | undefined)[] = []
  let release: () => void = () => {}
  const host = await render(createElement(Form, {
    kayan: courses,
    screen: screenOf(courses.pages.create!),
    client: draftClient(calls, () => new Promise((resolve) => (release = () => resolve({ id: 'made-k', title: 'Taj', _status: 'draft' })))),
    value: null,
    t,
    locale: 'en',
    onDone: (_row: unknown, effect?: string) => landed.push(effect),
    drafts: { autosave: 50 },
  }))
  await act(async () => {
    typeInto(host.querySelector('#courses-title')!, 'Taj')
  })
  await act(async () => sleep(150))
  assert.equal(calls.length, 1, 'the create is out')
  await render(createElement('div'))
  await act(async () => release())
  await act(async () => sleep(0))
  assert.deepEqual(landed, [], 'the host is never told, so nothing navigates away from wherever the person went')
})

const dialogText = () => window.document.querySelector('[data-slot="alert-dialog-content"]')?.textContent ?? undefined
const dialogButton = (words: string) => [...(window.document.querySelector('[data-slot="alert-dialog-content"]')?.querySelectorAll('button') ?? [])].find((one) => one.textContent?.trim() === words) as HTMLButtonElement | undefined

function LeavingHost({ client, left, block, deletes = true }: { client: Record<string, unknown>; left: string[]; block: { it?: () => void }; deletes?: boolean }): ReactElement {
  const [row, setRow] = useState<Record<string, unknown> | null>(null)
  const [blocked, setBlocked] = useState(false)
  block.it = () => setBlocked(true)
  return createElement(Form, {
    kayan: courses,
    // Standalone forms keep Cancel; the app shell supplies its own breadcrumb instead.
    client: client as never,
    value: row,
    t,
    locale: 'en',
    onDone: (made: unknown, effect?: string) => effect === 'create' && setRow(made as Record<string, unknown>),
    onCancel: () => left.push('cancel'),
    blocked: blocked ? { proceed: () => (left.push('proceed'), setBlocked(false)), reset: () => setBlocked(false) } : undefined,
    operations: { delete: deletes },
    drafts: { status: 'draft' as const, autosave: 50 },
  })
}
/** A client that records every write and delete, making `made-1` on a create. Its plain read finds no row (404), as for a draft never published, unless `published` holds one. */
const leavingClient = (calls: string[], published: { row?: Record<string, unknown> } = {}) => ({
  create: async (input: Record<string, unknown>, options?: object) => (calls.push(`create ${JSON.stringify(options ?? {})}`), { ...input, id: 'made-1', _status: 'draft' }),
  update: async (input: Record<string, unknown>, options?: object) => (calls.push(`update ${JSON.stringify(options ?? {})}`), { ...input, _status: 'draft' }),
  delete: async (input: Record<string, unknown>) => (calls.push(`delete ${String(input.id)}`), input),
  findByID: async () => {
    if (published.row) return published.row
    throw Object.assign(new Error('Not found'), { status: 404, data: { key: 'error.not_found.row' } })
  },
})

test('228a. nothing is autosaved while the discard question is open, from Cancel or from a navigation the host blocked, and the autosave resumes once it is answered with Cancel', async () => {
  const calls: string[] = []
  const left: string[] = []
  const block: { it?: () => void } = {}
  const host = await render(createElement(LeavingHost, { client: leavingClient(calls), left, block }))
  const title = () => host.querySelector('#courses-title')!
  await act(async () => {
    typeInto(title(), 'Taj')
  })
  await act(async () => {
    click(cancelOf(host)!)
  })
  assert.ok(dialogText()?.includes('Leave without saving?'), 'Cancel asks')
  await act(async () => sleep(200))
  assert.deepEqual(calls, [], 'and nothing is saved while it asks')
  assert.ok(dialogText()?.includes('Leave without saving?'), 'nor does the question go away')
  await act(async () => {
    click(dialogButton('Cancel')!)
  })
  await act(async () => sleep(200))
  assert.deepEqual(calls, ['create {"draft":true,"autosave":true}'], 'answered with Cancel, the autosave runs again')

  await act(async () => {
    typeInto(title(), 'Tajweed')
  })
  await act(async () => block.it!())
  assert.ok(dialogText()?.includes('Leave without saving?'), 'a navigation the host blocked asks the same question')
  await act(async () => sleep(200))
  assert.equal(calls.length, 1, 'and nothing is saved while it asks either')
})

test('228b. Discard on a create page whose row this page\'s autosave made deletes that row, from Cancel and from a blocked navigation, and never a row a save of the person\'s own wrote or one the page was opened on', async () => {
  for (const how of ['cancel', 'blocked'] as const) {
    const calls: string[] = []
    const left: string[] = []
    const block: { it?: () => void } = {}
    const host = await render(createElement(LeavingHost, { client: leavingClient(calls), left, block }))
    await act(async () => {
      typeInto(host.querySelector('#courses-title')!, 'Taj')
    })
    await act(async () => sleep(150))
    assert.deepEqual(calls, ['create {"draft":true,"autosave":true}'], 'the autosave made the row')
    await act(async () => {
      typeInto(host.querySelector('#courses-title')!, 'Tajweed')
    })
    await act(async () => (how === 'cancel' ? click(cancelOf(host)!) : block.it!()))
    await act(async () => {
      click(dialogButton('Discard changes')!)
    })
    await act(async () => sleep(0))
    assert.deepEqual(calls.slice(1), ['delete made-1'], `Discard from ${how} deletes the draft this page made`)
    assert.deepEqual(left, [how === 'cancel' ? 'cancel' : 'proceed'], 'and then leaves')
  }

  // A Save draft of the person's own keeps the row: it is theirs now.
  const calls: string[] = []
  const left: string[] = []
  const host = await render(createElement(LeavingHost, { client: leavingClient(calls), left, block: {} }))
  await act(async () => {
    typeInto(host.querySelector('#courses-title')!, 'Taj')
  })
  await act(async () => sleep(150))
  await act(async () => {
    typeInto(host.querySelector('#courses-title')!, 'Tajweed')
  })
  await act(async () => {
    click(buttonNamed(host, 'Save draft')!)
  })
  await act(async () => {
    typeInto(host.querySelector('#courses-title')!, 'Tajweed II')
  })
  await act(async () => {
    click(cancelOf(host)!)
  })
  await act(async () => {
    click(dialogButton('Discard changes')!)
  })
  await act(async () => sleep(0))
  assert.ok(!calls.some((one) => one.startsWith('delete')), `a row a save wrote is never deleted: ${calls.join(', ')}`)
  assert.deepEqual(left, ['cancel'])

  // An edit page's row is never this page's to delete.
  const edits: string[] = []
  const edit = await render(createElement(Form, { kayan: courses, client: leavingClient(edits) as never, value: { ...draftRow, _status: 'draft' }, t, locale: 'en', onDone: () => {}, onCancel: () => {}, drafts: { status: 'draft', autosave: 50 } }))
  await act(async () => {
    typeInto(edit.querySelector('#courses-title')!, 'Tajweed II')
  })
  await act(async () => {
    click(cancelOf(edit)!)
  })
  await act(async () => {
    click(dialogButton('Discard changes')!)
  })
  await act(async () => sleep(0))
  assert.deepEqual(edits, [], 'Discard on an edit page deletes nothing')
})

test('228d. an autosave that lands while the discard question is open leaves the question open, and once it is answered with Cancel the autosave runs again', async () => {
  const calls: DraftCall[] = []
  let release: () => void = () => {}
  let answer: () => Promise<unknown> = () => new Promise((resolve) => (release = () => resolve({ ...draftRow, _status: 'draft' })))
  const host = await render(createElement(Form, { kayan: courses, client: draftClient(calls, () => answer()), value: draftRow, t, locale: 'en', onDone: () => {}, onCancel: () => {}, drafts: { status: 'draft', autosave: 50 } }))
  await act(async () => {
    typeInto(host.querySelector('#courses-title')!, 'Tajweed II')
  })
  await act(async () => sleep(120))
  assert.equal(calls.length, 1, 'the autosave is out')
  await act(async () => {
    click(cancelOf(host)!)
  })
  assert.ok(dialogText()?.includes('Leave without saving?'), 'Cancel asks while it is out')
  answer = async () => ({ ...draftRow, _status: 'draft' })
  await act(async () => release())
  await act(async () => sleep(150))
  assert.ok(dialogText()?.includes('Leave without saving?'), 'the autosave landing leaves the question open')
  assert.equal(calls.length, 1, 'and nothing more is saved while it asks')
  await act(async () => {
    click(dialogButton('Cancel')!)
  })
  await act(async () => {
    typeInto(host.querySelector('#courses-title')!, 'Tajweed III')
  })
  await act(async () => sleep(150))
  assert.deepEqual(calls.map((one) => one.input.title), ['Tajweed II', 'Tajweed III'], 'answered with Cancel, a later change autosaves again')
})

test('228e. Discard keeps a draft this page made where the server reads it published since, or where the role holds no delete, and says so; a second press while the delete is out sends no second delete', async () => {
  const typed = async (host: HTMLElement) => {
    await act(async () => {
      typeInto(host.querySelector('#courses-title')!, 'Taj')
    })
    await act(async () => sleep(150))
    await act(async () => {
      typeInto(host.querySelector('#courses-title')!, 'Tajweed')
    })
    await act(async () => {
      click(cancelOf(host)!)
    })
  }
  // Published meanwhile, from another tab: the plain read finds it.
  const calls: string[] = []
  const published: { row?: Record<string, unknown> } = {}
  const left: string[] = []
  let host = await render(createElement(LeavingHost, { client: leavingClient(calls, published), left, block: {} }))
  await typed(host)
  published.row = { id: 'made-1', title: 'Taj', _status: 'published' }
  await act(async () => {
    click(dialogButton('Discard changes')!)
  })
  await act(async () => sleep(0))
  assert.deepEqual([calls.filter((one) => one.startsWith('delete')), left], [[], ['cancel']], 'a row published since is kept, and the page still leaves')

  // No delete key: kept, and the question says so.
  const keyless: string[] = []
  const gone: string[] = []
  host = await render(createElement(LeavingHost, { client: leavingClient(keyless), left: gone, block: {}, deletes: false }))
  await typed(host)
  assert.ok(dialogText()?.includes('The draft saved so far is kept.'), `the question says the draft is kept: ${dialogText()}`)
  await act(async () => {
    click(dialogButton('Discard changes')!)
  })
  await act(async () => sleep(0))
  assert.deepEqual([keyless.filter((one) => one.startsWith('delete')), gone], [[], ['cancel']], 'and nothing is deleted')

  // Two presses while the delete is out: one delete, one leave, and the question stays until it is done.
  let finish: () => void = () => {}
  const twice: string[] = []
  const twiceLeft: string[] = []
  const slow = { ...leavingClient(twice), delete: (input: Record<string, unknown>) => new Promise((resolve) => (twice.push(`delete ${String(input.id)}`), finish = () => resolve(input))) }
  host = await render(createElement(LeavingHost, { client: slow, left: twiceLeft, block: {} }))
  await typed(host)
  await act(async () => {
    click(dialogButton('Discard changes')!)
  })
  await act(async () => sleep(0))
  await act(async () => {
    click(dialogButton('Discard changes')!)
    press(window.document.querySelector('[data-slot="alert-dialog-content"]') as unknown as Element, 'Escape')
  })
  assert.equal(!!dialogText(), true, 'the question stays while the delete is out, Escape included')
  assert.equal(dialogButton('Discard changes')?.disabled, true, 'its Discard waits')
  await act(async () => finish())
  await act(async () => sleep(0))
  assert.deepEqual([twice.filter((one) => one.startsWith('delete')), twiceLeft], [['delete made-1'], ['cancel']], 'one delete, then one leave')
})

test('228f. once Discard is pressed nothing autosaves the edit it threw away, however slowly the navigation goes, on an edit page and on a create page whose draft it deleted', async () => {
  const calls: DraftCall[] = []
  const left: string[] = []
  const edit = await render(createElement(Form, { kayan: courses, client: draftClient(calls), value: draftRow, t, locale: 'en', onDone: () => {}, onCancel: () => left.push('cancel'), drafts: { status: 'draft', autosave: 50 } }))
  await act(async () => {
    typeInto(edit.querySelector('#courses-title')!, 'Tajweed II')
  })
  await act(async () => {
    click(cancelOf(edit)!)
  })
  await act(async () => {
    click(dialogButton('Discard changes')!)
  })
  await act(async () => sleep(200))
  assert.deepEqual([calls, left], [[], ['cancel']], 'the edit page saves nothing while the navigation is out')

  // A create page whose draft Discard deleted, the navigation still out.
  const made: string[] = []
  const slow: string[] = []
  const host = await render(createElement(LeavingHost, { client: leavingClient(made), left: slow, block: {} }))
  await act(async () => {
    typeInto(host.querySelector('#courses-title')!, 'Taj')
  })
  await act(async () => sleep(150))
  await act(async () => {
    typeInto(host.querySelector('#courses-title')!, 'Tajweed')
  })
  await act(async () => {
    click(cancelOf(host)!)
  })
  await act(async () => {
    click(dialogButton('Discard changes')!)
  })
  await act(async () => sleep(200))
  assert.deepEqual(made, ['create {"draft":true,"autosave":true}', 'delete made-1'], 'no update reaches the draft it deleted')
})

test('228c. the delete dialog names the row, confirms in a shipped key, says inside itself why a delete was refused and naming what still uses the row, says a failed one failed, and closes once one lands', async () => {
  const edit = plus(recordPage([{ form: ['title'] }]), 'danger', { button: 'delete', label: { en: 'Delete', ar: 'حذف' } })
  let answer: () => Promise<unknown> = async () => {
    throw Object.assign(new Error('Conflict'), { status: 409, data: { key: 'error.conflict.referenced', params: { kayan: 'courses', by: 'sessions' } } })
  }
  const landed: (string | undefined)[] = []
  const words: Record<string, string> = {
    'error.conflict.referencedBy': '{kind} still use this, so it is not deleted.',
    'sessions.plural': 'Sessions',
    'admin.deleteConfirm': 'Delete for good',
  }
  const host = await render(createElement(Form, {
    kayan: courses,
    screen: screenOf(edit),
    client: { create: async () => ({}), update: async () => ({}), delete: () => answer(), run: async () => ({}) },
    value: { id: 'a-row', title: 'Tajweed' },
    t: (key: string, fallback?: string) => words[key] ?? fallback,
    locale: 'en',
    onDone: (_row: unknown, effect?: string) => landed.push(effect),
    onCancel: () => {},
    operations: { delete: true },
  }))
  await act(async () => {
    click(host.querySelector('[data-region="danger"] [data-button="delete"]')!)
  })
  assert.ok(dialogText()?.includes('This applies to \u2068Tajweed\u2069. This cannot be undone.'), `the dialog names the row: ${dialogText()}`)
  assert.equal(dialogButton('Delete for good')?.textContent, 'Delete for good', 'and confirms in the shipped key where the kayan words none')
  await act(async () => {
    click(dialogButton('Delete for good')!)
  })
  assert.equal(window.document.querySelector('[data-slot="alert-dialog-content"] [role="alert"]')?.textContent, 'Sessions still use this, so it is not deleted.', 'a refusal is said inside the dialog, naming what uses the row')
  assert.equal(host.querySelector('[role="alert"]:not([data-slot="alert-dialog-content"] *)')?.textContent ?? '', '', 'and not behind it')
  answer = async () => {
    throw Object.assign(new Error('Internal server error'), { status: 500 })
  }
  await act(async () => {
    click(dialogButton('Delete for good')!)
  })
  assert.equal(window.document.querySelector('[data-slot="alert-dialog-content"] [role="alert"]')?.textContent, 'Something went wrong, so nothing was deleted. Try again.', 'a delete that failed says so')
  answer = async () => ({ id: 'a-row' })
  await act(async () => {
    click(dialogButton('Delete for good')!)
  })
  await act(async () => sleep(0))
  assert.deepEqual(landed, ['delete'], 'one that lands goes to the list')
  assert.equal(dialogText(), undefined, 'and the dialog closes')
})

test('228g. a delete refused because rows still use it says how many, names the ones the viewer reads in the viewer\'s locale, and counts the rest', async () => {
  const edit = plus(recordPage([{ form: ['title'] }]), 'danger', { button: 'delete', label: { en: 'Delete', ar: 'حذف' } })
  let uses: unknown[] = []
  const words: Record<string, string> = { 'courses.singular': 'Course', 'courses.plural': 'Courses', 'sessions.plural': 'Sessions', 'admin.deleteConfirm': 'Delete for good' }
  const host = await render(createElement(Form, {
    kayan: courses,
    screen: screenOf(edit),
    client: { create: async () => ({}), update: async () => ({}), run: async () => ({}), delete: async () => {
      throw Object.assign(new Error('Conflict'), { status: 409, data: { key: 'error.conflict.referenced', params: { kayan: 'tags', by: 'courses', uses } } })
    } },
    value: { id: 'a-row', title: 'Tajweed' },
    t: (key: string, fallback?: string) => words[key] ?? fallback,
    locale: 'en',
    onDone: () => {},
    onCancel: () => {},
    operations: { delete: true },
  }))
  const refusalFor = async (given: unknown[]) => {
    uses = given
    await act(async () => {
      click(host.querySelector('[data-region="danger"] [data-button="delete"]')!)
    })
    await act(async () => {
      click(dialogButton('Delete for good')!)
    })
    const said = window.document.querySelector('[data-slot="alert-dialog-content"] [role="alert"]')?.textContent
    await act(async () => {
      click(dialogButton('Cancel')!)
    })
    return said
  }
  assert.equal(await refusalFor([{ by: 'courses', count: 2, titles: ['Course 2', 'First Course'] }]), 'Used by 2 Courses: Course 2, First Course. Take it out of them first.')
  assert.equal(await refusalFor([{ by: 'courses', count: 3, titles: [{ en: 'Course 2', ar: 'دورة 2' }] }]), 'Used by 3 Courses: Course 2, 2 more. Take it out of them first.', 'a localized title in the viewer\'s locale, and the rest counted')
  assert.equal(await refusalFor([{ by: 'courses', count: 1, titles: [] }, { by: 'sessions', count: 4, titles: [] }]), 'Used by 1 Course. Used by 4 Sessions. Take it out of them first.', 'rows the viewer does not read are counted, never named')
})

test('228h. a refusal a kayan words itself, a unique pair taken, is said in the kayan\'s words, and in the shared ones where the kayan words none', async () => {
  const words: Record<string, string> = { 'courses.conflict.unique': 'Another course already holds this.', 'error.conflict.unique': 'Another row already holds that value.' }
  const said = async (kayan: string) => {
    await toasted()
    const host = await render(withToaster(createElement(Form, {
      kayan: courses,
      client: { create: async () => ({}), update: async () => {
        throw Object.assign(new Error('Conflict'), { status: 409, data: { key: 'error.conflict.unique', params: { kayan } } })
      }, delete: async () => ({}) },
      value: { id: 'a-row', title: 'Tajweed' },
      t: (key: string, fallback?: string) => words[key] ?? fallback,
      locale: 'en',
      onDone: () => {},
    })))
    await act(async () => typeInto(host.querySelector('#courses-title')!, 'Tajweed II'))
    await act(async () => fire(host.querySelector('form')!, 'submit'))
    return (await toasted()).join(' ')
  }
  assert.ok((await said('courses')).includes('Another course already holds this.'), 'the kayan\'s own words')
  delete words['courses.conflict.unique']
  assert.ok((await said('courses')).includes('Another row already holds that value.'), 'and the shared words where it words none')
})

test('172l. the status in a form with no header is coloured like the header\'s pill and keeps its word', async () => {
  for (const [status, words, colour] of [['draft', 'Draft', 'bg-muted'], ['published', 'Published', 'bg-emerald-500/15'], ['changed', 'Changed', 'bg-amber-500/15']] as const) {
    const host = await render(createElement(Form, { kayan: courses, client: draftClient([]), value: draftRow, t, locale: 'en', onDone: () => {}, drafts: { status } }))
    const note = host.querySelector('span[data-status]')
    assert.equal(note?.textContent?.includes(words), true, `a ${status} row keeps its word`)
    assert.equal(note?.className.split(' ').includes(colour), true, `in ${colour}`)
  }
})

const standing = (host: HTMLElement) => [host.querySelector('[data-status]')?.getAttribute('data-status'), !!host.querySelector('[data-view-switch]'), host.querySelector('[data-draft-banner]')?.getAttribute('data-draft-banner')]

test('173a. a landed autosave or draft save turns a published row to Changed with the switch and the strip, and a draft stays Draft, without a reload', async () => {
  const autosaving = await render(createElement(Form, { kayan: courses, screen: screenOf(courses.pages.edit!), client: publishedClient([], []), value: draftRow, t, locale: 'en', onDone: () => {}, drafts: { status: 'published', autosave: 50 } }), { record: draftRow })
  assert.deepEqual(standing(autosaving), ['published', false, undefined])
  await act(async () => {
    typeInto(autosaving.querySelector('#courses-title')!, 'Tajweed I')
  })
  await act(async () => sleep(150))
  assert.deepEqual(standing(autosaving), ['changed', true, 'draft'], 'an autosave on a published row')

  const saving = await render(createElement(Form, { kayan: courses, screen: screenOf(courses.pages.edit!), client: publishedClient([], []), value: draftRow, t, locale: 'en', onDone: () => {}, drafts: { status: 'published' } }), { record: draftRow })
  await act(async () => {
    typeInto(saving.querySelector('#courses-title')!, 'Tajweed I')
  })
  await act(async () => {
    click(buttonNamed(saving, 'Save draft')!)
  })
  assert.deepEqual(standing(saving), ['changed', true, 'draft'], 'and a Save draft')

  const drafted = await render(createElement(Form, { kayan: courses, screen: screenOf(courses.pages.edit!), client: publishedClient([], []), value: draftRow, t, locale: 'en', onDone: () => {}, drafts: { status: 'draft', autosave: 50 } }), { record: draftRow })
  await act(async () => {
    typeInto(drafted.querySelector('#courses-title')!, 'Tajweed I')
  })
  await act(async () => sleep(150))
  assert.deepEqual(standing(drafted), ['draft', false, undefined], 'a row never published stays Draft')
})

test('173b. a landed Publish turns a changed row to Published and hides the switch and the strip, and View published reads the new copy', async () => {
  const asked: Asked[] = []
  const host = await render(createElement(Form, { kayan: courses, screen: screenOf(courses.pages.edit!), client: publishedClient([], asked), value: draftRow, t, locale: 'en', onDone: () => {}, drafts: { status: 'changed' } }), { record: draftRow })
  await act(async () => {
    click(toggleNamed(host, 'Published')!)
  })
  await act(async () => sleep(0))
  assert.equal(asked.length, 1, 'the published copy was read')
  await act(async () => {
    click(toggleNamed(host, 'Draft')!)
  })
  await act(async () => {
    click(publishOf(host)!)
  })
  await act(async () => sleep(0))
  assert.deepEqual(standing(host), ['published', false, undefined])
  await act(async () => {
    typeInto(host.querySelector('#courses-title')!, 'Tajweed I')
  })
  await act(async () => {
    click(buttonNamed(host, 'Save draft')!)
  })
  await act(async () => {
    click(toggleNamed(host, 'Published')!)
  })
  await act(async () => sleep(0))
  assert.equal(asked.length, 2, 'a published copy read before the publish is read again, not served from before it')

  const drafted = await render(createElement(Form, { kayan: courses, screen: screenOf(courses.pages.edit!), client: publishedClient([], []), value: draftRow, t, locale: 'en', onDone: () => {}, drafts: { status: 'draft' } }), { record: draftRow })
  await act(async () => {
    click(publishOf(drafted)!)
  })
  assert.equal(standing(drafted)[0], 'published', 'a draft row published is Published too')
})

test('173c. a landed Discard changes turns a changed row to Published and hides the switch and the strip', async () => {
  const host = await render(createElement(Form, { kayan: courses, screen: screenOf(courses.pages.edit!), client: publishedClient([], []), value: draftRow, t, locale: 'en', onDone: () => {}, operations: { restoreVersion: true }, drafts: { status: 'changed' } }), { record: draftRow })
  await act(async () => {
    click(buttonNamed(host, 'Discard changes')!)
  })
  await act(async () => {
    click(window.document.querySelector('[data-button="confirm-discard-draft"]') as unknown as Element)
  })
  await act(async () => sleep(0))
  assert.deepEqual(standing(host), ['published', false, undefined])
})

test('173d. a create page\'s first landed autosave shows Draft', async () => {
  const host = await render(createElement(Form, { kayan: courses, screen: screenOf(courses.pages.create!), client: draftClient([], async (call) => ({ ...call.input, id: 'made-1', _status: 'draft' })), value: null, t, locale: 'en', onDone: () => {}, drafts: { autosave: 50 } }))
  assert.deepEqual(standing(host), [undefined, false, undefined], 'no status before anything is saved')
  await act(async () => {
    typeInto(host.querySelector('#courses-title')!, 'Tajweed I')
  })
  await act(async () => sleep(150))
  assert.deepEqual(standing(host), ['draft', false, undefined])
})

// happy-dom lays nothing out, so each step reads the classes that carry the behaviour.
const classesOf = (element: Element | null | undefined) => (element?.getAttribute('class') ?? '').split(/\s+/)

test('176a. a list never widens the page: its table scrolls inside its own frame, its header and toolbar wrap, and the list may shrink inside whatever layout holds it', async () => {
  const host = await render(createElement(List, {
    kayan: courses,
    screen: screenOf(courses.pages.list!),
    page: { docs: [draftRow], hasNextPage: false, hasPrevPage: false, limit: 10, nextPage: null, page: 1, prevPage: null, totalDocs: 1, totalPages: 1 },
    query: {},
    t,
    locale: 'en',
    onQuery: () => {},
    href: (id: string) => `/courses/${id}`,
    newHref: '/courses/new',
  }))
  const table = host.querySelector('table')!
  const section = table.closest('section')!
  assert.equal(classesOf(section).includes('min-w-0'), true, 'the list may shrink below its widest row, as a grid or flex item')
  assert.equal(classesOf(table.parentElement).includes('overflow-auto'), true, 'the table scrolls sideways inside its own container')
  assert.deepEqual(['overflow-hidden', 'rounded-lg'].map((one) => classesOf(table.parentElement?.parentElement).includes(one)), [true, true], 'inside a frame that only clips it to its rounded corners')
  const header = section.querySelector(':scope > header')!
  assert.equal(classesOf(header).includes('flex-wrap'), true, 'the title and the New button wrap within the screen')
  assert.equal(classesOf(header.firstElementChild).includes('min-w-0'), true, 'and the title may shrink beside the button')
  const toolbar = host.querySelector('input[type="search"]')!.closest('.space-y-4')!.firstElementChild!.lastElementChild
  assert.equal(classesOf(toolbar).includes('flex-wrap'), true, 'the toolbar\'s buttons wrap rather than push the card wider')
})

test('176b. below sm the header keeps the trigger, the title and the pill, the form\'s actions and its autosave note sit in a bar fixed to the bottom, and its switch tops the form; sm and up keep one header row', async () => {
  const refusal = Object.assign(new Error('Conflict'), { status: 409, data: { key: 'error.conflict', params: {} } })
  let failing = false
  const client = { ...publishedClient([], []), update: async () => {
    if (failing) throw refusal
    return {}
  } }
  const host = await render(createElement(Form, { kayan: courses, screen: screenOf(courses.pages.edit!), client, value: draftRow, t, locale: 'en', onDone: () => {}, onCancel: () => {}, drafts: { status: 'changed', autosave: 50 } }), { record: draftRow })
  const controls = host.querySelector('[data-region="header"] [data-node="controls"]')!
  const bar = controls.querySelector('[data-action-bar]')
  assert.ok(bar, 'the actions sit in a bar inside the controls')
  for (const one of ['fixed', 'inset-x-0', 'bottom-0', 'flex-wrap', 'sm:contents']) assert.equal(classesOf(bar).includes(one), true, `the bar carries ${one}`)
  assert.equal(classesOf(bar).some((one) => one.startsWith('pb-') && one.includes('safe-area-inset-bottom')), true, 'and clears the phone\'s bottom inset')
  assert.equal(bar.contains(controls.querySelector('[data-status]')), false, 'the pill stays in the header')
  assert.deepEqual(['ms-auto', 'flex', 'items-center', 'fixed'].map((one) => classesOf(controls.firstElementChild).includes(one)), [true, true, true, false], 'which at sm and up is the one row it was')
  const title = host.querySelector('[data-region="header"] h1')
  assert.equal(title?.getAttribute('title'), title?.textContent, 'the header\'s title, cut short on a phone, carries its whole text')
  const form = host.querySelector('form')!
  assert.equal(bar.querySelector('[data-button="publish"]')?.getAttribute('form'), form.id, 'Publish changes is in the bar and still submits the page\'s form by its id')
  assert.ok(bar.contains(buttonNamed(host, 'Save draft') ?? null), 'Save draft stays in the bar')
  assert.equal(buttonNamed(host, 'Back to list'), undefined, 'the breadcrumb already supplies the way back')
  assert.ok(host.querySelector('[data-back]'))
  // The switch is not in the phone's bar, where it took a quarter of the screen: it sits at the top of the form below xl, and beside the actions from xl up.
  const switches = [...host.querySelectorAll('[data-view-switch]')]
  assert.equal(switches.length, 2, 'the Draft | Published switch is drawn for each width')
  assert.equal(bar.contains(switches.find((one) => classesOf(one).includes('hidden')) ?? null), true, 'the one in the bar is hidden below xl')
  const phone = switches.find((one) => classesOf(one).includes('xl:hidden') && !classesOf(one).includes('hidden'))
  assert.equal(!!phone && form.contains(phone) && !controls.contains(phone), true, 'and the phone\'s sits in the form, out of the fixed bar')
  assert.equal(classesOf(controls.querySelector('[data-status]')).some((one) => one.startsWith('max-sm:text-')), false, 'the pill keeps its 12 pixel text on a phone')

  await act(async () => {
    typeInto(host.querySelector('#courses-title')!, 'Tajweed I')
  })
  await act(async () => sleep(150))
  assert.equal(bar.contains(controls.querySelector('[data-autosave]')), true, 'the autosave note is in the bar')

  failing = true
  await act(async () => {
    click(bar.querySelector('[data-button="publish"]')!)
  })
  assert.equal(controls.querySelector('[role="alert"]'), null, 'a refusal takes no room in the bar, where a toast says it')
  await toasted()
})

test('176c. the record layout puts main, then side, then the danger zone in the document, and places the danger zone back under the form from lg up', async () => {
  const host = await render(createElement(RecordPage, { regions: { main: 'Main', side: 'Side', danger: createElement('button', {}, 'Delete') }, page: { path: '/courses/:id' } } as never), { record: draftRow })
  const layout = host.querySelector('[data-layout="record"]')!
  assert.deepEqual([...layout.children].map((one) => one.getAttribute('data-region')), ['main', 'side', 'danger'], 'stacked on a phone in the order a person reads them')
  assert.deepEqual(['lg:col-start-2', 'lg:row-span-2'].map((one) => classesOf(layout.querySelector(':scope > [data-region="side"]')).includes(one)), [true, true], 'beside the form and the danger zone from lg up')
  assert.equal(classesOf(layout.querySelector(':scope > [data-region="danger"]')).includes('lg:col-start-1'), true, 'the danger zone under the form from lg up')
})

test('176d. the dashboard\'s figures sit two to a row on a phone', async () => {
  const host = await render(createElement(Dashboard, { loaderData: { courses: 3, open: 2, fees: [['SAR', 150]] } }), { kayan: undefined })
  const grid = host.querySelector('[data-kpi]')!.parentElement
  assert.deepEqual([classesOf(grid).includes('grid-cols-2'), classesOf(grid).includes('grid-cols-1')], [true, false])
})

test('176e. the phone\'s bar measures itself, the document keeps that much room under the page and keeps a focused field clear of it, and with no bar it keeps none', async () => {
  const root = window.document.documentElement.style
  const room = () => [root.getPropertyValue('padding-bottom'), root.getPropertyValue('scroll-padding-bottom')]
  const watched = new Map<Element, (entries: unknown[]) => void>()
  const real = Reflect.get(globalThis, 'ResizeObserver')
  Reflect.set(globalThis, 'ResizeObserver', class {
    measured: (entries: unknown[]) => void
    constructor(measured: (entries: unknown[]) => void) { this.measured = measured }
    observe(element: Element) { watched.set(element, this.measured) }
    unobserve() {}
    disconnect() {}
  })
  try {
    const host = await render(createElement(Form, { kayan: courses, screen: screenOf(courses.pages.edit!), client: draftClient([]), value: draftRow, t, locale: 'en', onDone: () => {}, onCancel: () => {}, drafts: { status: 'changed' } }), { record: draftRow })
    const measured = watched.get(host.querySelector('[data-action-bar]')!)
    assert.ok(measured, 'the bar is watched for its size')
    const measure = (blockSize: number) => act(async () => measured!([{ borderBoxSize: [{ inlineSize: 320, blockSize }] }]))
    await measure(164)
    assert.deepEqual(room(), ['164px', '164px'], 'below sm the document keeps the bar\'s height free under the page and as room for a focused field')
    await measure(0)
    assert.deepEqual(room(), ['', ''], 'from sm up the bar draws no box of its own, and the document keeps no room')
    await measure(212)
    assert.deepEqual(room(), ['212px', '212px'], 'and it follows the bar when the bar grows, a refusal or a wrapped row')

    // The shell's header writes its own height for what sticks under it, and takes it off with it.
    const header = [...watched.keys()].find((one) => one.matches('[data-region="header"]'))
    assert.ok(header, 'the header is watched for its size')
    await act(async () => watched.get(header!)!([{ borderBoxSize: [{ inlineSize: 640, blockSize: 101 }] }]))
    assert.equal(root.getPropertyValue('--header-bar-height'), '101px', 'a header that wrapped writes its height as --header-bar-height')
    assert.equal(root.getPropertyValue('--header-height'), '', 'and never --header-height, which its own min-height reads')
    await render(createElement('div'))
    assert.equal(root.getPropertyValue('--header-bar-height'), '', 'a header that goes takes it with it')
    const hidden = { path: '/courses/:id', page: { shell: screen.layouts.app!, header: [{ controls: {} }], main: [{ layout: screen.layouts.record!, when: { 'record.archived': { equals: true } }, main: [{ form: ['title'] }] }] } } as unknown as PageClient
    watched.clear()
    const hiding = await render(createElement(Form, { kayan: courses, screen: screenOf(hidden), client: draftClient([]), value: draftRow, t, locale: 'en', onDone: () => {}, onCancel: () => {} }), { record: draftRow })
    // The shell's header measures itself too, so only the action bar is counted.
    assert.deepEqual([!!hiding.querySelector('[data-node="controls"]'), !!hiding.querySelector('[data-action-bar]'), [...watched.keys()].filter((one) => one.matches('[data-action-bar]')).length], [true, false, 0], 'a page that holds the controls node and draws no form has no bar to measure')
    assert.deepEqual(room(), ['', ''], 'so the room the last page kept goes with it')
  } finally {
    Reflect.set(globalThis, 'ResizeObserver', real)
  }
})

/** Unmounts the tree, then empties the query client it read through, so a read in flight lands nowhere. */
const release = async (queries: { clear(): void }) => {
  await act(async () => mounted?.unmount())
  mounted = undefined
  queries.clear()
}

const listOn = (kayan: ClientKayan, docs: Record<string, unknown>[], over: Record<string, unknown> = {}) =>
  createElement(List, {
    kayan,
    screen: screenOf(kayan.pages.list!, kayan),
    page: pageOf(docs),
    query: {},
    t,
    locale: 'en',
    onQuery: () => {},
    href: (id: string) => `/${kayan.name}/${id}`,
    newHref: `/${kayan.name}/new`,
    ...over,
  })

test('235a. a list with tabs opens on its first, holds the find to each tab\'s where, takes a tab off the URL only where the list names it, and a click goes to that tab\'s first page', async () => {
  const tabs = [
    { tab: 'active', label: { en: 'Active', ar: 'النشطة' }, where: { archived: { not_equals: true } } },
    { tab: 'archived', label: { en: 'Archived', ar: 'المؤرشفة' }, where: { archived: { equals: true } } },
    { tab: 'all', label: { en: 'All', ar: 'الكل' } },
  ]
  const { listOf } = await import('../registry/node-tree.ts')
  const node = { ...listOf(screenOf(courses.pages.list!, courses))!, tabs }
  const rules = rulesOf({ kayan: courses, node, maxLimit: screen.maxLimit })
  assert.deepEqual(findOf({ kayan: courses, query: {}, node }).where, { archived: { not_equals: true } }, 'the first tab holds a list that names none')
  assert.deepEqual(findOf({ kayan: courses, query: readQuery({ tab: 'archived' }, rules), node }).where, { archived: { equals: true } }, 'and the URL\'s tab its own')
  assert.equal(findOf({ kayan: courses, query: readQuery({ tab: 'all' }, rules), node }).where, undefined, 'a tab with no where holds nothing')
  assert.throws(() => readQuery({ tab: 'deleted' }, rules), /This link names tab "deleted", which this list does not offer\./)
  assert.deepEqual(writeQuery({ tab: 'archived', page: 2 }), { tab: 'archived', page: '2' }, 'and the tab is written back')
  const asked: unknown[] = []
  const host = await render(listOn(courses, [{ id: 'c1', title: 'Tajweed' }], { node, query: { page: 3 }, onQuery: (next: unknown) => asked.push(next) }))
  const drawn = [...host.querySelectorAll('[data-list-tab]')]
  assert.deepEqual(drawn.map((one) => [one.textContent, one.getAttribute('aria-selected')]), [['Active', 'true'], ['Archived', 'false'], ['All', 'false']], 'each tab, the first selected')
  await act(async () => click(drawn[1]!))
  assert.deepEqual(asked.at(-1), { page: 1, tab: 'archived' }, 'a tab opens on its first page')
})

test('177a. a list page\'s header names the kayan by its plural and an edit page by its singular', async () => {
  const { pageOf: drawPage } = await import('../registry/nodes.tsx')
  // The key itself, so the two words are told apart whatever the copy says.
  const keyed = { t: (key: string) => key, locale: 'en' }
  const shell = ({ regions }: { regions: Record<string, ReactElement> }) => createElement('div', null, regions.header)
  const titles = async (page: PageClient) => {
    const drawn = { refs: { [screen.layouts.app!]: shell } as never, kayan: courses, page: page as Extract<PageClient, { page: unknown }> }
    const host = await render(createElement('div', null, drawPage(drawn, { kayan: courses, copy: keyed, issues: {}, scope: {}, component: () => null, layout: () => null, control: () => null })))
    return [...host.querySelectorAll('[data-node="title"]')].map((one) => one.textContent)
  }
  const list = courses.pages.list as Extract<PageClient, { page: unknown }>
  assert.deepEqual(await titles({ ...list, page: { ...list.page, header: [{ title: {} }] } }), ['courses.plural'], 'an explicit list title node')
  assert.deepEqual(await titles(courses.pages.edit!), ['courses.singular'], 'the edit page, which lists the course\'s sessions and is still one course')
})

test('177b. the filter panel stays closed until the person opens it, and a list whose URL filters opens with it shown', async () => {
  const closed = await render(listOn(courses, [draftRow]))
  assert.equal(!!closed.querySelector('[data-mithaq-filters]'), false, 'no empty row of filters on a list nobody filtered')
  const toggle = buttonNamed(closed, 'Filters')
  assert.equal(toggle?.getAttribute('aria-expanded') ?? 'no button', 'false', 'a Filters button says the panel is closed')
  await act(async () => click(toggle!))
  assert.equal(closed.querySelector('[data-mithaq-filters]')?.getAttribute('data-mithaq-filters'), '1', 'and opens it on its first row')
  assert.equal(toggle?.getAttribute('aria-expanded'), 'true')
  const filtered = await render(listOn(courses, [draftRow], { query: { where: { or: [{ and: [{ title: { like: 'Taj' } }] }] } } }))
  assert.equal(filtered.querySelector('[data-mithaq-filters]')?.getAttribute('data-mithaq-filters'), '1', 'a list the URL filters shows its filter')
})

test('177c. the bulk buttons and the count appear once a row is ticked, and the dashboard\'s list draws New and no second Create', async () => {
  const operations = { create: true, deleteMany: true, updateMany: true }
  const host = await render(listOn(courses, [draftRow], { operations, run: async () => ({}) }))
  // Drawn is not hidden: the buttons stay mounted so an open dialog outlives the ticked rows, and are hidden with none.
  const drawn = (words: string) => [...host.querySelectorAll('button')].some((one) => one.textContent?.trim() === words && !one.closest('[hidden]'))
  const bulk = () => [!!host.querySelector('[data-mithaq-selected]'), drawn('Delete'), drawn('Update')]
  assert.deepEqual(bulk(), [false, false, false], 'nothing ticked, no count and no bulk button')
  assert.equal(!!host.querySelector('[aria-label="Select this row"]'), true, 'while the boxes to tick are there')
  await act(async () => click(host.querySelector('[aria-label="Select this row"]')!))
  assert.deepEqual(bulk(), [true, true, true], 'one ticked, the count and both buttons')
  assert.equal(host.querySelector('[data-mithaq-selected]')?.getAttribute('data-mithaq-selected'), '1')
  await act(async () => click(host.querySelector('[aria-label="Select this row"]')!))
  assert.deepEqual(bulk(), [false, false, false], 'and gone again once nothing is')
  const named = (words: string) => [...host.querySelectorAll('a, button')].filter((one) => one.textContent?.trim() === words).length
  assert.deepEqual([named('New'), named('Create')], [1, 0], 'one way to add a course: New')
  // A page with no New button, because the kayan has no create page, keeps a toolbar create a project names.
  const list = courses.pages.list as Extract<PageClient, { page: unknown }>
  const toolbar = { ...list, page: JSON.parse(JSON.stringify(list.page).replace('"list":{', '"list":{"toolbar":[{"button":"create","label":{"en":"Create","ar":"إنشاء"}}],')) }
  const bare = await render(listOn(courses, [draftRow], { operations, run: async () => ({}), creates: false, screen: { ...screenOf(toolbar), page: toolbar } }))
  assert.deepEqual([...bare.querySelectorAll('a, button')].filter((one) => ['New', 'Create'].includes(one.textContent?.trim() ?? '')).map((one) => one.textContent?.trim()), ['Create'])
  // Each button is drawn for its own key and for no other: a bulk is its own catalog key.
  for (const [key, shown] of [['deleteMany', [true, true, false]], ['updateMany', [true, false, true]]] as const) {
    await render(listOn(courses, [draftRow], { operations: { [key]: true }, run: async () => ({}) }))
    await act(async () => click(window.document.querySelector('[aria-label="Select this row"]')! as unknown as Element))
    const shownIn = (words: string) => [...window.document.querySelectorAll('button')].some((one) => one.textContent?.trim() === words && !one.closest('[hidden]'))
    assert.deepEqual([!!window.document.querySelector('[data-mithaq-selected]'), shownIn('Delete'), shownIn('Update')], [...shown], `"${key}" alone draws its own button`)
  }
})

test('177d. a list draws no search box when no field of it can be searched', async () => {
  const unsearched = JSON.parse(JSON.stringify(sessions.pages.list)) as { page: { main: { main: { list: { search?: string[] } }[] }[] } }
  delete unsearched.page.main[0]!.main[0]!.list.search
  const none = await render(listOn(sessions, [{ id: 's1', course: 'c1', startsAt: '2026-10-01T09:00:00.000Z', capacity: 12 }], { screen: screenOf(unsearched as never, sessions) }))
  assert.equal(none.querySelectorAll('input[type="search"]').length, 0, 'a session names no searchable field of its own')
  const searched = await render(listOn(sessions, [{ id: 's1', course: 'c1', startsAt: '2026-10-01T09:00:00.000Z', capacity: 12 }]))
  assert.equal(searched.querySelectorAll('input[type="search"]').length, 1, 'and the sessions list searches its course\'s title')
  const some = await render(listOn(courses, [draftRow]))
  assert.equal(some.querySelectorAll('input[type="search"]').length, 1, 'courses search their title and summary')
})

test('177e. a date and a moment read in one long format per locale from Intl, the same in a column and in a relationship\'s title', async () => {
  const { nameOfRow } = await import('../registry/relationship-control.tsx')
  // Drawn and mounted, since a moment settles on the viewer's zone once it has mounted.
  const cell = async (kind: string, value: unknown, locale: string) =>
    (await render(createElement('span', null, cells[kind]!({ kayan: courses, field: fieldOf({ name: 'at', kind }), value, t, locale })), { locale })).textContent ?? ''
  assert.equal(await cell('date', '2026-07-31', 'en'), 'July 31, 2026', 'a calendar day, its own day whatever the zone')
  const arabicDay = await cell('date', '2026-07-31', 'ar')
  assert.ok(arabicDay.includes('يوليو'), `with the Arabic month in Arabic: ${arabicDay}`)
  const moment = await cell('datetime', '2026-08-09T12:00:00.000Z', 'en')
  assert.match(moment, /^August 9, 2026.*\d:\d\d/, 'a moment is the same day with its time')
  const arabicMoment = await cell('datetime', '2026-08-09T12:00:00.000Z', 'ar')
  assert.ok(/أغسطس/.test(arabicMoment) && !/[A-Za-z]/.test(arabicMoment), 'and reads all Arabic in Arabic')
  assert.equal(nameOfRow({ row: { id: 's1', startsAt: '2026-08-09T12:00:00.000Z' }, title: 'startsAt', locale: 'en', kind: 'datetime' }), moment, 'a session titled by its start reads the way the column does')
})

test('177f. a course\'s fee reads with the row\'s currency in both locales', async () => {
  const { FeeCell } = await import('../../../templates/features/courses/courses/ui/fee-cell.tsx')
  const path = courses.fields.find((one) => one.name === 'fee')!.cell
  const row = { ...draftRow, fee: 450, currency: 'SAR' }
  const fee = async (locale: string) => {
    const host = await render(listOn(courses, [row], { locale, screen: screenOf(courses.pages.list!, courses, { [path]: FeeCell }) }), { locale })
    return host.querySelector('tr[data-row="a-row"]')?.textContent ?? ''
  }
  assert.match(await fee('en'), /SAR\s450\.00/, `the English list: ${await fee('en')}`)
  assert.ok((await fee('ar')).includes('ر.س'), `the Arabic list: ${await fee('ar')}`)
})

test('177g. an enrollment\'s session reads as its course with its start, from one read of the page\'s sessions and one of their courses', async () => {
  const { SessionCell } = await import('../../../templates/features/courses/enrollments/ui/session-cell.tsx')
  const path = enrollments.fields.find((one) => one.name === 'session')!.cell
  const rows: Record<string, Record<string, unknown>[]> = {
    sessions: [{ id: 's1', course: 'c1', startsAt: '2026-10-01T09:00:00.000Z' }, { id: 's2', course: 'c1', startsAt: '2026-10-08T09:00:00.000Z' }],
    courses: [{ id: 'c1', title: 'Tajweed' }],
  }
  const reads: string[] = []
  const client = async ({ kayan, operation, input }: { kayan: string; operation: string; input: Record<string, unknown> }) => {
    reads.push(`${kayan}.${operation}`)
    const ids = (input.where as { id: { in: string[] } }).id.in
    const docs = (rows[kayan] ?? []).filter((one) => ids.includes(String(one.id)))
    return pageOf(docs)
  }
  // Inside the list's own context, as the host draws every list, and the host's query client, which is where a cell's reads are kept.
  const queries = new QueryClient()
  const list = listOn(enrollments, [{ id: 'e1', session: 's1', student: 'u1' }, { id: 'e2', session: 's2', student: 'u2' }], { screen: screenOf(enrollments.pages.list!, enrollments, { [path]: SessionCell }) })
  const host = await render(createElement(QueryClientProvider, { client: queries }, createElement(ListContext, { value: list.props as never }, list)), { client: client as never, kayan: enrollments })
  await act(async () => sleep(10))
  const text = (id: string) => host.querySelector(`tr[data-row="${id}"]`)?.textContent ?? ''
  assert.ok(text('e1').includes('Tajweed') && text('e1').includes('October 1, 2026'), `the first enrollment: ${text('e1')}`)
  assert.ok(text('e2').includes('Tajweed') && text('e2').includes('October 8, 2026'), `the second: ${text('e2')}`)
  assert.deepEqual(reads.sort(), ['courses.find', 'sessions.find'], 'one read per kayan for the whole page')
  await release(queries)
})

test('177h. the phone\'s bar falls back to its own height where the browser gives no border box', async () => {
  const root = window.document.documentElement.style
  const watched = new Map<Element, (entries: unknown[]) => void>()
  const real = Reflect.get(globalThis, 'ResizeObserver')
  Reflect.set(globalThis, 'ResizeObserver', class {
    measured: (entries: unknown[]) => void
    constructor(measured: (entries: unknown[]) => void) { this.measured = measured }
    observe(element: Element) { watched.set(element, this.measured) }
    unobserve() {}
    disconnect() {}
  })
  try {
    const host = await render(createElement(Form, { kayan: courses, screen: screenOf(courses.pages.edit!), client: draftClient([]), value: draftRow, t, locale: 'en', onDone: () => {}, onCancel: () => {}, drafts: { status: 'changed' } }), { record: draftRow })
    const bar = host.querySelector('[data-action-bar]') as HTMLElement
    Object.defineProperty(bar, 'offsetHeight', { configurable: true, value: 96 })
    await act(async () => watched.get(bar)!([{ target: bar }]))
    assert.equal(root.getPropertyValue('padding-bottom'), '96px', 'Safari before 15.4 hands no borderBoxSize, and the bar is measured by its offsetHeight')
    await act(async () => watched.get(bar)!([{ target: bar, borderBoxSize: { inlineSize: 320, blockSize: 80 } }]))
    assert.equal(root.getPropertyValue('padding-bottom'), '96px', 'Firefox before 92 hands one box rather than a list, read the same way')
  } finally {
    Reflect.set(globalThis, 'ResizeObserver', real)
  }
})

test('177i. a moment hydrates against markup drawn in another zone without a mismatch, then reads in the viewer\'s own zone', async () => {
  const { renderToString } = await import('react-dom/server')
  const { hydrateRoot } = await import('react-dom/client')
  const draw = () => createElement('div', null, cells.datetime!({ kayan: courses, field: fieldOf({ name: 'at', kind: 'datetime' }), value: '2026-08-09T12:00:00.000Z', t, locale: 'en' }))
  const zone = process.env.TZ
  const problems: unknown[] = []
  const logged = console.error
  try {
    process.env.TZ = 'UTC'
    const served = renderToString(draw())
    // Two o'clock the next morning, which is the day after the server's.
    process.env.TZ = 'Pacific/Kiritimati'
    const host = mount()
    host.innerHTML = served
    console.error = (...told: unknown[]) => void problems.push(told)
    let root: ReturnType<typeof hydrateRoot> | undefined
    await act(async () => {
      root = hydrateRoot(host, draw(), { onRecoverableError: (error: unknown) => void problems.push(error) })
    })
    assert.equal(problems.length, 0, `no mismatch to report: ${problems.map(String).join(' | ')}`)
    assert.match(host.textContent ?? '', /^August 10, 2026.*2:00/, 'and the viewer\'s zone is what stands once it has mounted')
    assert.equal(host.querySelector('time')?.getAttribute('datetime'), '2026-08-09T12:00:00.000Z', 'on a time element that carries the instant')
    await act(async () => root!.unmount())
  } finally {
    console.error = logged
    if (zone === undefined) delete process.env.TZ
    else process.env.TZ = zone
  }
})

test('177j. a fee in a currency code Intl does not know reads as the plain number', async () => {
  const { FeeCell } = await import('../../../templates/features/courses/courses/ui/fee-cell.tsx')
  const path = courses.fields.find((one) => one.name === 'fee')!.cell
  const host = await render(listOn(courses, [{ ...draftRow, fee: 450, currency: 'not-a-code' }], { screen: screenOf(courses.pages.list!, courses, { [path]: FeeCell }) }))
  assert.match(host.querySelector('tr[data-row="a-row"]')?.textContent ?? '', /450/, 'the row is drawn, and its fee with it')
})

test('177k. a session whose course and start the viewer may not read says the viewer cannot see it, never the id the column holds', async () => {
  const { SessionCell } = await import('../../../templates/features/courses/enrollments/ui/session-cell.tsx')
  const path = enrollments.fields.find((one) => one.name === 'session')!.cell
  const queries = new QueryClient()
  const list = listOn(enrollments, [{ id: 'e1', session: 's1', student: 'u1' }], { screen: screenOf(enrollments.pages.list!, enrollments, { [path]: SessionCell }) })
  const host = await render(
    createElement(QueryClientProvider, { client: queries }, createElement(ListContext, { value: list.props as never }, list)),
    { client: (async ({ kayan }: { kayan: string }) => pageOf(kayan === 'sessions' ? [{ id: 's1' }] : [])) as never, kayan: enrollments },
  )
  await act(async () => sleep(10))
  assert.equal(host.querySelectorAll('tr[data-row="e1"] .grid').length, 0, 'no empty box drawn in its place')
  const said = host.querySelector('tr[data-row="e1"]')?.textContent ?? ''
  assert.ok(said.includes('Not available') && !said.includes('s1') && !said.includes('u1'), `no id stands: ${said}`)
  await release(queries)
})

test('177l. a session\'s read runs again when its query is invalidated, a read that failed is not kept, and a renamed course shows', async () => {
  const { SessionCell } = await import('../../../templates/features/courses/enrollments/ui/session-cell.tsx')
  const path = enrollments.fields.find((one) => one.name === 'session')!.cell
  const rows: Record<string, Record<string, unknown>[]> = {
    sessions: [{ id: 's1', course: 'c1', startsAt: '2026-10-01T09:00:00.000Z' }],
    courses: [{ id: 'c1', title: 'Tajweed' }],
  }
  let down = true
  const client = async ({ kayan, input }: { kayan: string; input: Record<string, unknown> }) => {
    if (down) throw new Error('network')
    const ids = (input.where as { id: { in: string[] } }).id.in
    return pageOf((rows[kayan] ?? []).filter((one) => ids.includes(String(one.id))))
  }
  // No retry of the client's own, so the second attempt is the one under test.
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // One page object for the whole test, as the host's cache keeps while the rows are equal.
  const list = listOn(enrollments, [{ id: 'e1', session: 's1', student: 'u1' }], { screen: screenOf(enrollments.pages.list!, enrollments, { [path]: SessionCell }) })
  const host = await render(createElement(QueryClientProvider, { client: queries }, createElement(ListContext, { value: list.props as never }, list)), { client: client as never, kayan: enrollments })
  await act(async () => sleep(10))
  const text = () => host.querySelector('tr[data-row="e1"]')?.textContent ?? ''
  assert.ok(text().includes('—') && !text().includes('s1') && !text().includes('Tajweed'), `the failed read leaves a dash, never the id: ${text()}`)
  down = false
  await act(async () => queries.invalidateQueries())
  await act(async () => sleep(10))
  assert.ok(text().includes('Tajweed'), `and the next read answers: ${text()}`)
  rows.courses = [{ id: 'c1', title: 'Tajweed II' }]
  await act(async () => queries.invalidateQueries())
  await act(async () => sleep(10))
  assert.ok(text().includes('Tajweed II'), `a renamed course is read again though the page object is the same: ${text()}`)
  await release(queries)
})

test('177m. a filter that arrives in the URL after the list mounted opens the panel, and the person\'s own toggle then rules', async () => {
  const where = { or: [{ and: [{ title: { like: 'Taj' } }] }] }
  const draw = (query: Record<string, unknown>) => listOn(courses, [draftRow], { query })
  const host = await render(draw({}))
  // Drawn again under the same wrapper `render` put it in, so it is the same list and not a new one.
  const again = (query: Record<string, unknown>) => mounted!.render(createElement(ScreenContext, { value: state }, withComponents(draw(query))))
  const panel = () => !!host.querySelector('[data-mithaq-filters]')
  assert.equal(panel(), false)
  await act(async () => again({ where }))
  assert.equal(panel(), true, 'back or forward to a filtered link opens it')
  await act(async () => click(buttonNamed(host, 'Filters')!))
  assert.equal(panel(), false, 'and the person may close it')
  await act(async () => again({ where, limit: 25 }))
  assert.equal(panel(), false, 'which a later change of the URL does not undo')
})

test('177n. the Filters button points at the panel only while the panel is there', async () => {
  const host = await render(listOn(courses, [draftRow]))
  const toggle = buttonNamed(host, 'Filters')!
  assert.equal(toggle.hasAttribute('aria-controls'), false, 'closed, there is nothing to point at')
  await act(async () => click(toggle))
  const id = toggle.getAttribute('aria-controls')
  assert.ok(id, 'open, it names the panel')
  assert.equal(host.querySelector('[data-mithaq-filters]')?.closest(`[id="${id}"]`) !== null, true, 'which is there under that id')
})

test('177o. the count\'s live region is there before a row is ticked, and an open bulk dialog outlives the ticked rows leaving the page but confirms nothing', async () => {
  const sent: unknown[] = []
  const props = { operations: { updateMany: true }, writes: () => true, run: async (operation: string, input: unknown) => void sent.push([operation, input]) }
  const draw = (docs: Record<string, unknown>[]) => listOn(courses, docs, props)
  const host = await render(draw([draftRow]))
  const live = () => host.querySelector('[aria-live="polite"]')
  assert.equal(live()?.textContent, '', 'a region that is empty, so the first tick is announced')
  await act(async () => click(host.querySelector('[aria-label="Select this row"]')!))
  assert.equal(live()?.textContent, '1 selected')
  await act(async () => click(buttonNamed(host, 'Update')!))
  const dialog = () => window.document.querySelector('[data-slot="alert-dialog-content"]')
  const confirm = () => dialog()!.querySelector('button[type="submit"]') as unknown as HTMLButtonElement
  assert.ok(dialog(), 'the dialog is open')
  assert.equal(confirm().disabled, false, 'and confirms over the row that is ticked')
  await act(async () => mounted!.render(createElement(ScreenContext, { value: state }, withComponents(draw([{ ...draftRow, id: 'b-row' }])))))
  assert.ok(dialog(), 'and stays open')
  assert.equal(confirm().disabled, true, 'but confirms nothing over no row')
  await act(async () => {
    click(confirm())
    fire(dialog()!.querySelector('form') as unknown as Element, 'submit')
  })
  assert.deepEqual(sent, [], 'and not one call is sent, for a where of no id is not a call anyone ticked')
})

test('177o2. a project\'s own bulk button that ignores busy sends nothing once the ticked rows have left', async () => {
  const { listOf } = await import('../registry/node-tree.ts')
  const sent: unknown[] = []
  const ticked = listOf(listScreen())!
  // The template's bulk buttons, each drawn by a component of the project's own, with no confirm to ask.
  const node = { ...ticked, bulk: ticked.bulk!.map(({ confirm: _, ...one }) => ({ ...one, component: 'stubborn' })) }
  // A button that never reads `busy`, so only the list can stop its call.
  const Stubborn = ({ run }: { run: (input: Record<string, unknown>) => unknown }) => createElement('button', { type: 'button', 'data-stubborn': true, onClick: () => void run({}) }, 'Go')
  const draw = (docs: Record<string, unknown>[]) =>
    listOn(courses, docs, { node, screen: screenOf(courses.pages.list!, courses, { stubborn: Stubborn }), operations: { deleteMany: true, updateMany: true }, writes: () => true, run: async (operation: string, input: unknown) => void sent.push([operation, input]) })
  const host = await render(draw([draftRow]))
  const go = () => host.querySelector('[data-stubborn]')!
  await act(async () => click(host.querySelector('[aria-label="Select this row"]')!))
  await act(async () => click(go()))
  assert.equal(sent.length > 0, true, 'over the row that is ticked, it sends')
  sent.length = 0
  await act(async () => click(host.querySelector('[aria-label="Select this row"]')!))
  await act(async () => mounted!.render(createElement(ScreenContext, { value: state }, withComponents(draw([{ ...draftRow, id: 'b-row' }])))))
  await act(async () => click(go()))
  assert.deepEqual(sent, [], 'over no ticked row, not one call is sent')
})

test('177p. the bulk wrapper is hidden by its attribute alone, and the empty count takes no room', async () => {
  const host = await render(listOn(courses, [draftRow], { operations: { updateMany: true }, writes: () => true, run: async () => ({}) }))
  const wrapper = () => buttonNamed(host, 'Update')!.closest('[hidden]')
  const live = () => host.querySelector('[aria-live="polite"]')!
  // A class that sets `display` outranks the hidden attribute wherever the page's own reset does not hold.
  assert.equal(wrapper()?.hasAttribute('class'), false, 'nothing ticked: hidden, and no class that could undo it')
  assert.equal(/\bsr-only\b/.test(live().className), true, 'and the empty live region is out of the layout, not an empty box between two gaps')
  await act(async () => click(host.querySelector('[aria-label="Select this row"]')!))
  assert.equal(wrapper() === null, true, 'ticked: shown')
  assert.equal(/sr-only/.test(live().className), false, 'and the count is drawn')
})

test('177q. a moment drawn on the client alone reads in the viewer\'s zone on its first paint', async () => {
  const seen: (string | undefined)[] = []
  const host = mount()
  const root = createRoot(host)
  const moment = cells.datetime!({ kayan: courses, field: fieldOf({ name: 'at', kind: 'datetime' }), value: '2026-08-09T12:00:00.000Z', t, locale: 'en' })
  // A layout effect runs in the commit that put the markup there, before any passive effect of the cell could swap it.
  const Probe = () => (useLayoutEffect(() => void seen.push(host.querySelector('time')?.textContent ?? undefined)), null)
  await act(async () => root.render(createElement('div', null, moment, createElement(Probe))))
  assert.match(seen[0] ?? '', /\d:\d\d/, `the first paint has the time and not only the day: ${seen[0]}`)
  await act(async () => root.unmount())
})

const enrolled = (queries: unknown, client: unknown, docs: Record<string, unknown>[], cell: unknown) => {
  const path = enrollments.fields.find((one) => one.name === 'session')!.cell
  const list = listOn(enrollments, docs, { screen: screenOf(enrollments.pages.list!, enrollments, { [path]: cell as never }) })
  return createElement(ScreenContext, { value: { ...state, client: client as never, kayan: enrollments } }, createElement(QueryClientProvider, { client: queries }, createElement(ListContext, { value: list.props as never }, withComponents(list))))
}

test('177r. a read a refusal answered reads as no rows and is not tried again, and one that failed is', async () => {
  const { SessionCell } = await import('../../../templates/features/courses/enrollments/ui/session-cell.tsx')
  const refusal = Object.assign(new Error('refused'), { data: { key: 'error.forbidden' } })
  const attempts = async (thrown: Error) => {
    let calls = 0
    const queries = new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 0 } } })
    const host = mount()
    const root = createRoot(host)
    await act(async () => root.render(enrolled(queries, async () => (calls++, Promise.reject(thrown)), [{ id: 'e1', session: 's1', student: 'u1' }], SessionCell)))
    await act(async () => sleep(30))
    const text = host.querySelector('tr[data-row="e1"]')?.textContent ?? ''
    await act(async () => root.unmount())
    queries.clear()
    return { calls, text }
  }
  const refused = await attempts(refusal)
  assert.equal(refused.calls, 1, 'a refusal is the viewer\'s access answering, so it is asked once')
  assert.ok(refused.text.includes('Not available') && !refused.text.includes('s1'), `and says it is not available, never the id: ${refused.text}`)
  assert.equal((await attempts(new Error('network'))).calls, 2, 'a failure is asked again')
})

test('177s. the same rows in another order are the same read', async () => {
  const { SessionCell } = await import('../../../templates/features/courses/enrollments/ui/session-cell.tsx')
  const reads: string[] = []
  const client = async ({ kayan, input }: { kayan: string; input: Record<string, unknown> }) => {
    reads.push(kayan)
    return pageOf((input.where as { id: { in: string[] } }).id.in.map((id) => ({ id, ...(kayan === 'sessions' && { course: 'c1' }) })))
  }
  const queries = new QueryClient()
  const host = mount()
  const root = createRoot(host)
  const rows = [{ id: 'e1', session: 's1', student: 'u1' }, { id: 'e2', session: 's2', student: 'u2' }]
  await act(async () => root.render(enrolled(queries, client, rows, SessionCell)))
  await act(async () => sleep(10))
  const first = reads.length
  assert.ok(first > 0, 'the page is read')
  await act(async () => root.render(enrolled(queries, client, [...rows].reverse(), SessionCell)))
  await act(async () => sleep(10))
  assert.equal(reads.length, first, 'and a re-sort of it is not read again')
  await act(async () => root.unmount())
  queries.clear()
})

test('182a. the form\'s own row of buttons wraps, so on a page with no header controls its buttons never set the page\'s width, and a row of fields puts each on a line of its own before squeezing it', async () => {
  const host = await render(createElement(Form, { kayan: courses, screen: screenOf(recordPage([{ form: ['title', { row: ['fee', 'currency'] }] }])), client: publishedClient([], []), value: draftRow, t, locale: 'en', onDone: () => {}, onCancel: () => {} }), { record: draftRow })
  const row = cancelOf(host)?.parentElement
  assert.equal(row?.contains(buttonNamed(host, 'Save') ?? null), true, 'Cancel and Save share the form\'s own row')
  assert.equal(classesOf(row).includes('flex-wrap'), true, 'which wraps rather than holding every button on one line')
  const fields = host.querySelector('[data-node="row"]')
  assert.deepEqual(['flex-wrap', '[&>[data-control]]:min-w-40', '[&>[data-field-value]]:min-w-40'].map((one) => classesOf(fields).includes(one)), [true, true, true], 'a row of fields, controls or read-only values, wraps once a field would be narrower than its value and its affixes')
  assert.equal(classesOf(fields).includes('[&>*]:min-w-40'), false, 'and the minimum is a field\'s alone, so a button or a short select beside it is not forced to 160 pixels')
  assert.deepEqual([...fields!.children].map((one) => one.hasAttribute('data-control')), [true, true], 'which the fields of the row carry')
})

test('182b. a create opened as a drawer draws only its page: its title once, the drawer\'s own for a screen reader alone, no nav, inside a padded scroll', async () => {
  const { RecordFrame } = await import('../registry/record-frame.tsx')
  const page = { path: '/courses/new', mode: 'drawer', page: { shell: screen.layouts.app!, header: [{ title: {} }], nav: [{ nav: {} }], main: [{ form: ['title'] }] } } as unknown as PageClient
  await render(createElement(RecordFrame, { mode: 'drawer', title: 'Course', closeLabel: 'Close', onClose: () => {} }, createElement(Form, { kayan: courses, screen: screenOf(page), client: publishedClient([], []), value: null, t, locale: 'en', onDone: () => {}, onCancel: () => {} })))
  const drawer = window.document.querySelector('[data-document-drawer]') as unknown as Element | null
  assert.equal(drawer?.querySelectorAll('[data-node="nav"]').length, 0, 'the list\'s shell already draws the nav, so the drawer draws none')
  assert.equal(drawer?.querySelectorAll('[data-node="title"]').length, 1, 'the page\'s title node is drawn once')
  assert.equal(drawer?.querySelector('[data-node="title"]')?.tagName, 'H2', 'as an h2, as Payload titles its drawer, so the list\'s h1 behind it stays the page\'s one')
  assert.equal(classesOf(drawer?.querySelector('[data-slot="sheet-title"]')).includes('sr-only'), true, 'and the drawer\'s own title is for a screen reader alone')
  const box = drawer?.querySelector('[data-node="title"]')?.closest('.overflow-y-auto')
  assert.deepEqual(['p-4', 'gap-4'].map((one) => classesOf(box).includes(one)), [true, true], 'the page sits in a padded box that scrolls, as the sheet\'s does')
})

test('182c. the nav marks the page\'s own kayan current, Home only on a page of the screen\'s own, and the portal header keeps its title over a menu that shrinks to its avatar on a phone', async () => {
  const { NavLinks } = await import('../registry/nav-links.tsx')
  const { PortalTopShell } = await import('../../../templates/mithaq/src/ui/top-shell.tsx')
  const { Home } = await import('../../../templates/asas/src/ui-portal/home.tsx')
  const current = (host: Element) => [...host.querySelectorAll('a[aria-current]')].map((one) => `${one.getAttribute('href')} ${one.getAttribute('aria-current')}`)
  const shell = (nav: ReactElement) => createElement(PortalTopShell, { regions: { header: createElement('h1', null, 'Courses'), nav, main: null } })
  assert.deepEqual(current(await render(shell(createElement(NavLinks)), { kayan: courses })), ['/dashboard/courses page'], 'on a courses page Courses is current, and nothing else')
  assert.deepEqual(current(await render(shell(createElement(NavLinks)), { kayan: sessions })), ['/dashboard/sessions page'], 'on a sessions page Sessions')
  assert.deepEqual(current(await render(shell(createElement(NavLinks)), { kayan: undefined, path: '/dashboard/reports' })), [], 'a page of the screen\'s own that is not its home marks nothing')
  const home = await render(createElement(Home, {}), { kayan: undefined, path: '/dashboard' })
  assert.deepEqual(current(home), ['/dashboard page'], 'and on the screen\'s own home, Home alone')
  const title = home.querySelector('[data-region="header"] h1')
  assert.equal(title?.getAttribute('title'), title?.textContent, 'the header\'s title, cut short on a phone, carries its whole text')
  const menu = home.querySelector('[data-region="header"] [data-slot="dropdown-menu-trigger"]')?.closest('[data-sidebar="menu"]')?.parentElement
  assert.deepEqual(['w-12', 'sm:w-56'].map((one) => classesOf(menu).includes(one)), [true, true], 'the user menu is its avatar alone on a phone and the whole card from sm up')
})

test('182d. a list with no external title keeps its heading beside the primary action on and off a screen', async () => {
  const props = {
    kayan: courses,
    page: { docs: [draftRow], hasNextPage: false, hasPrevPage: false, limit: 10, nextPage: null, page: 1, prevPage: null, totalDocs: 1, totalPages: 1 },
    query: {},
    t,
    locale: 'en',
    onQuery: () => {},
    href: (id: string) => `/courses/${id}`,
    newHref: '/courses/new',
  }
  assert.equal((await render(createElement(List, { ...props, screen: screenOf(courses.pages.list!) }))).querySelectorAll('h1').length, 1, 'on a screen its own header holds the title')
  assert.equal((await render(createElement(List, props))).querySelectorAll('h1').length, 1, 'off one the list heads itself')
})

test('182e. a list page whose header holds no title node keeps its own heading, so the page has its one h1, and a title nested under a layout still stands in for it', async () => {
  const tree = courses.pages.list as Extract<PageClient, { page: unknown }>
  const props = {
    kayan: courses,
    page: { docs: [draftRow], hasNextPage: false, hasPrevPage: false, limit: 10, nextPage: null, page: 1, prevPage: null, totalDocs: 1, totalPages: 1 },
    query: {},
    t,
    locale: 'en',
    onQuery: () => {},
    href: (id: string) => `/courses/${id}`,
    newHref: '/courses/new',
  }
  const without = { ...tree, page: { ...tree.page, header: [] } } as unknown as PageClient
  assert.equal((await render(createElement(List, { ...props, screen: screenOf(without) }))).querySelectorAll('h1').length, 1, 'no title node, so the list heads itself')
  const nested = { ...tree, page: { ...tree.page, header: [{ row: [{ title: {} }] }] } } as unknown as PageClient
  assert.equal((await render(createElement(List, { ...props, screen: screenOf(nested) }))).querySelectorAll('h1').length, 0, 'a title the page draws in a row is its heading')
  const gated = { ...tree, page: { ...tree.page, header: [{ title: {}, when: { '$user.collections.courses.delete': { equals: true } } }] } } as unknown as PageClient
  const holds = { collections: { courses: { delete: true } } }
  assert.equal((await render(createElement(List, { ...props, access: holds, screen: screenOf(gated) }))).querySelectorAll('h1').length, 0, 'a title gated on a key the viewer holds is drawn, so the list drops its own')
  assert.equal((await render(createElement(List, { ...props, access: { collections: { courses: {} } }, screen: screenOf(gated) }))).querySelectorAll('h1').length, 1, 'and one the viewer lacks is not, so the list keeps its heading')
})

test('182f. a page opened as a drawer draws no nav at any depth', async () => {
  const { RecordFrame } = await import('../registry/record-frame.tsx')
  const page = { path: '/courses/new', mode: 'drawer', page: { shell: screen.layouts.app!, header: [{ title: {} }], main: [{ row: [{ nav: {} }] }, { form: ['title'] }] } } as unknown as PageClient
  await render(createElement(RecordFrame, { mode: 'drawer', title: 'Course', closeLabel: 'Close', onClose: () => {} }, createElement(Form, { kayan: courses, screen: screenOf(page), client: publishedClient([], []), value: null, t, locale: 'en', onDone: () => {}, onCancel: () => {} })))
  assert.equal(window.document.querySelector('[data-document-drawer]')?.querySelectorAll('[data-node="nav"]').length, 0, 'a nav inside a row is left out too')
})

test('182g. the portal\'s page and main column are one shrinkable track, so no wide child stretches the page past the screen', async () => {
  const { Page } = await import('../../../templates/asas/src/ui-portal/page.tsx')
  const { PortalTopShell } = await import('../../../templates/mithaq/src/ui/top-shell.tsx')
  const track = 'grid-cols-[minmax(0,1fr)]'
  const grid = await render(createElement(Page, { regions: { main: 'x' }, page: { path: '/courses' } as never }))
  assert.equal(classesOf(grid.querySelector('[data-layout="page"]')).includes(track), true, 'the page layout')
  const shell = await render(createElement(PortalTopShell, { regions: { header: null, nav: null, main: 'x' } }))
  assert.equal(classesOf(shell.querySelector('[data-region="main"]')).includes(track), true, 'and the shell\'s main')
})

test('184d. a person\'s actions open from the row\'s menu after its View, the role is picked in its own dialog that outlives the menu and sends nothing unchanged, and the rename dialog says what it changes, holds the slug left to right and closes on Cancel', async () => {
  const { UserMenu } = await import('../../../templates/asas/src/ui-backoffice/user-actions.tsx')
  const { OrganizationActions } = await import('../../../templates/asas/src/ui-backoffice/organization-actions.tsx')
  const { listOf } = await import('../registry/node-tree.ts')
  const backoffice = asas.targets.backoffice.client
  const over = { screen: backoffice, access: { permissions: '*' as const }, user: { name: 'Admin', email: 'admin@example.com' }, locale: 'ar', dir: 'rtl' as const }
  const users = backoffice.kayan.user!
  const drawn = screenOf(users.pages.list!, users)
  const path = listOf(drawn)?.menu
  assert.equal(path, './src/ui-backoffice/user-actions.tsx#UserMenu', 'the users list names its menu')
  const listed = (rows: Record<string, unknown>[]) => listOn(users, rows, { screen: { ...drawn, refs: { ...(drawn.refs as object), [path!]: UserMenu } }, edit: { client: {}, writes: {} }, operations: { update: false } })
  const person = { id: 'u2', name: 'Hana', email: 'hana@example.com', role: 'user', banned: false }
  const host = await render(listed([person, { id: 'u1', name: 'Admin', email: 'admin@example.com', role: 'super_admin' }]), over)
  const items = async (id: string) => {
    await act(async () => click(host.querySelector(`[data-row-menu="${id}"]`)!))
    return [...window.document.querySelectorAll('[data-row-action], [data-action]')].map((one) => one.getAttribute('data-row-action') ?? one.getAttribute('data-action'))
  }
  assert.deepEqual(await items('u1'), ['view'], 'the viewer\'s own row offers View and no action')
  await act(async () => press(window.document.activeElement as unknown as Element, 'Escape'))
  await act(async () => sleep(50))
  assert.deepEqual(await items('u2'), ['view', 'set-role', 'ban', 'impersonate'], 'another\'s row offers every action after View, in order')
  await act(async () => click(window.document.querySelector('[data-action="set-role"]') as unknown as Element))
  await act(async () => sleep(50))
  const confirm = () => window.document.querySelector('[data-button="confirm"]') as unknown as HTMLButtonElement
  assert.equal(confirm() !== null, true, 'the dialog stays open once the menu has closed')
  assert.equal(confirm().disabled, true, 'the role\'s own dialog sends nothing while the role is unchanged')
  const described = () => window.document.querySelector('[data-slot="alert-dialog-description"]')?.textContent ?? ''
  assert.equal(described().includes('Give'), false, `and asks nothing of the role the person already holds: ${described()}`)
  const picker = window.document.querySelector('[data-role="chosen"]') as unknown as HTMLSelectElement
  assert.equal(picker !== null, true, 'and picks the role inside it')
  await act(async () => {
    picker.value = 'support'
    fire(picker as unknown as Element, 'change')
  })
  assert.equal(confirm().disabled, false, 'and sends once it changed')
  assert.equal(described().includes('Give Hana'), true, `and asks it then: ${described()}`)
  await act(async () => click([...window.document.querySelectorAll('[data-slot="alert-dialog-cancel"]')].at(-1) as unknown as Element))
  await act(async () => sleep(50))
  assert.equal(window.document.querySelector('[data-button="confirm"]'), null, 'and Cancel closes it')

  const organizations = backoffice.kayan.organization!
  const renaming = await render(createElement(OrganizationActions, { kayan: organizations, field: organizations.fields.find((one) => one.name === 'slug')!, value: 'admin-org', row: { id: 'o1', name: 'Admin org' }, t, locale: 'ar' } as never), over)
  await act(async () => click(renaming.querySelector('[data-action="rename"]')!))
  const dialog = () => window.document.querySelector('[role="dialog"]')
  assert.equal(dialog() !== null, true, 'Rename opens its dialog')
  assert.equal((window.document.querySelector('input[name="slug"]') as unknown as HTMLInputElement).getAttribute('dir'), 'ltr', 'whose slug reads left to right')
  assert.ok((dialog()!.querySelector('[data-slot="dialog-description"]')?.textContent ?? '').length > 0, 'and which says what a rename changes')
  assert.deepEqual([...dialog()!.querySelectorAll('button')].map((one) => one.textContent), ['Cancel', 'Save'], 'and its two buttons and no close the primitive names in English alone')
  const cancel = [...dialog()!.querySelectorAll('button')].find((one) => one.textContent === 'Cancel')
  assert.equal(cancel !== undefined, true, 'and offers Cancel')
  await act(async () => click(cancel as unknown as Element))
  await act(async () => sleep(50))
  assert.equal(window.document.querySelector('input[name="slug"]') === null, true, 'which closes it')
})

test('217t. the rename dialog leaves validation to the page, and refuses an empty name and a slug of the wrong shape in its own words before sending', async () => {
  const { OrganizationActions } = await import('../../../templates/asas/src/ui-backoffice/organization-actions.tsx')
  const backoffice = asas.targets.backoffice.client
  const organizations = backoffice.kayan.organization!
  const sent: string[] = []
  const fetched = globalThis.fetch
  globalThis.fetch = (async (url: string) => (sent.push(String(url)), new Response('{}'))) as typeof fetch
  try {
    const host = await render(createElement(OrganizationActions, { kayan: organizations, field: organizations.fields.find((one) => one.name === 'slug')!, value: 'admin-org', row: { id: 'o1', name: 'Admin org' }, t, locale: 'ar' } as never), { screen: backoffice, access: { permissions: '*' as const }, locale: 'ar', dir: 'rtl' as const })
    await act(async () => click(host.querySelector('[data-action="rename"]')!))
    const form = window.document.querySelector('[role="dialog"] form')!
    assert.equal(form.hasAttribute('novalidate'), true, 'the browser validates nothing')
    await act(async () => typeInto(window.document.querySelector('input[name="name"]') as unknown as Element, ''))
    await act(async () => typeInto(window.document.querySelector('input[name="slug"]') as unknown as Element, 'Bad Slug'))
    await act(async () => fire(form as unknown as Element, 'submit'))
    assert.deepEqual(sent, [], 'nothing is sent')
    assert.equal(window.document.querySelector('#organization-name-o1-error')?.textContent, 'This field is required.', 'an empty name is required')
    assert.ok(window.document.querySelector('#organization-slug-o1-error')?.textContent?.startsWith('A slug is lowercase'), 'and a slug says its shape')
    assert.equal(window.document.querySelector('input[name="slug"]')?.getAttribute('aria-invalid'), 'true')
    // Both boxes say they are required to a screen reader too.
    assert.deepEqual(['name', 'slug'].map((name) => window.document.querySelector(`input[name="${name}"]`)?.getAttribute('aria-required')), ['true', 'true'])
  } finally {
    globalThis.fetch = fetched
  }
})

test('234a. a rename that lands says so in a green toast, closes its dialog and asks the page to read again, and never reloads it', async () => {
  await toasted()
  const { OrganizationActions } = await import('../../../templates/asas/src/ui-backoffice/organization-actions.tsx')
  const backoffice = asas.targets.backoffice.client
  const organizations = backoffice.kayan.organization!
  const fetched = globalThis.fetch
  const reload = window.location.reload
  let reloads = 0
  let refreshed = 0
  const refresh = () => refreshed++
  window.addEventListener('mithaq:refresh', refresh)
  Object.defineProperty(window.location, 'reload', { configurable: true, value: () => reloads++ })
  const bodies: unknown[] = []
  globalThis.fetch = (async (_url: string, init?: RequestInit) => (bodies.push(JSON.parse(String(init?.body))), new Response('{}'))) as typeof fetch
  try {
    const host = await render(withToaster(createElement(OrganizationActions, { kayan: organizations, field: organizations.fields.find((one) => one.name === 'slug')!, value: 'admin-org', row: { id: 'o1', name: 'Admin org', names: JSON.stringify({ en: 'Admin org', ar: 'منظمة الإدارة' }) }, t, locale: 'en' } as never)), { screen: backoffice, access: { permissions: '*' as const }, locale: 'en', dir: 'ltr' as const })
    await act(async () => click(host.querySelector('[data-action="rename"]')!))
    const arabic = window.document.querySelector('input[name="name-ar"]') as HTMLInputElement | null
    assert.equal(arabic?.value, 'منظمة الإدارة', 'the rename asks the name in each other locale too, as it stands')
    assert.equal(arabic?.required, false, 'and may leave it empty, to fall back to the first')
    await act(async () => typeInto(window.document.querySelector('input[name="name"]') as unknown as Element, 'Hana $& Academy'))
    await act(async () => fire(window.document.querySelector('[role="dialog"] form') as unknown as Element, 'submit'))
    await act(async () => sleep(0))
    assert.deepEqual(bodies, [{ id: 'o1', names: { en: 'Hana $& Academy', ar: 'منظمة الإدارة' }, slug: 'admin-org' }], 'and sends each locale\'s name')
    assert.deepEqual(await toasted(), ['success: The organization is now named Hana $& Academy.'], 'a toast says it landed, with the name as written')
    assert.deepEqual([window.document.querySelector('[role="dialog"] form') === null, refreshed, reloads], [true, 1, 0], 'the dialog closed, and the page asked to refresh once and not reloaded')
  } finally {
    globalThis.fetch = fetched
    window.removeEventListener('mithaq:refresh', refresh)
    Object.defineProperty(window.location, 'reload', { configurable: true, value: reload })
  }
})

test('184e. a backoffice record of a membership, an assignment and an enrollment is titled by its person\'s name, and by its kind while the person is not read', async () => {
  const { pageOf: drawPage, frameOf } = await import('../registry/nodes.tsx')
  const { api } = fakeApi({ user: [{ id: 'u1', name: 'Hana Saleh', email: 'hana@example.com' }] })
  const client = ({ kayan: target, input }: { kayan: string; input: Record<string, unknown> }) => api[target]!.find(input)
  const shell = ({ regions }: { regions: Record<string, ReactElement> }) => createElement('div', null, regions.header, regions.main)
  const titleOn = async (name: string, row: Record<string, unknown>, locale: string) => {
    const kayan = backoffice.kayan[name]!
    const view = kayan.pages.view as Extract<PageClient, { page: unknown }>
    const page = { refs: { [backoffice.layouts.app!]: shell, [backoffice.layouts.record!]: RecordPage } as never, kayan, page: view }
    const copy = { t, locale }
    const host = await render(createElement('div', null, drawPage(page, {
      kayan, copy, issues: {}, scope: { record: row }, component: () => null, control: () => null,
      layout: ({ path, regions, index }) => frameOf({ screen: page, t: copy.t, path, regions, key: index }),
    })), { screen: backoffice, kayan, record: row, client, locale })
    await act(async () => sleep(10))
    return host.querySelector('h1[data-node="title"]')?.textContent ?? ''
  }
  for (const locale of ['en', 'ar']) {
    assert.equal(await titleOn('member', { id: 'm1', userId: 'u1', organizationId: 'o1', role: 'member' }, locale), 'Hana Saleh', `a membership by its person in ${locale}`)
    assert.equal(await titleOn('memberRoles', { id: 'a1', user: 'u1', role: 'registrar', organization: 'o1' }, locale), 'Hana Saleh', `an assignment by its person in ${locale}`)
    assert.equal(await titleOn('enrollments', { id: 'e1', student: 'u1', session: 's1', organization: 'o1' }, locale), 'Hana Saleh', `an enrollment by its student in ${locale}`)
  }
  const unread = await titleOn('member', { id: 'm2', userId: 'u9', organizationId: 'o1', role: 'member' }, 'en')
  assert.ok(unread.length > 0 && unread !== 'u9', `a person the read does not answer for leaves the kind's name, never the id: ${unread}`)
})

const richOf = (...children: unknown[]) => ({ root: { type: 'root', version: 1, direction: null, format: '', indent: 0, children } })
const textOf = (text: string, format = 0) => ({ type: 'text', version: 1, text, format, detail: 0, mode: 'normal', style: '' })
const blockOf = (type: string, children: unknown[], more: Record<string, unknown> = {}) => ({ type, version: 1, direction: null, format: '', indent: 0, children, ...more })

test('185c. the viewer draws a stored value\'s heading, list and bold text over the screen\'s nodes, a link only through a scheme a browser follows without running anything, and a project\'s own node spread onto the defaults', async () => {
  const { RichTextViewer, RichTextContext, defaultPicks, viewsOf } = await import('../registry/rich-text.tsx')
  const { defaultNodes } = await import('../registry/rich-text-nodes.ts')
  const linkTo = (url: string, text: string) => ({ type: 'link', version: 1, url, rel: null, target: null, title: null, direction: null, format: '', indent: 0, children: [textOf(text)] })
  const value = richOf(
    blockOf('heading', [textOf('Quantum')], { tag: 'h2' }),
    blockOf('paragraph', [textOf('Covers '), textOf('entanglement', 1), textOf(' and '), linkTo('javascript:alert(1)', 'a script'), textOf(' and '), linkTo('data:text/html,<b>x</b>', 'some data'), textOf(' and '), linkTo('https://example.com/', 'a page')], { textFormat: 0, textStyle: '' }),
    blockOf('list', [blockOf('listitem', [textOf('First')], { value: 1 }), blockOf('listitem', [textOf('Second')], { value: 2 })], { listType: 'bullet', start: 1, tag: 'ul' }),
    { type: 'horizontalrule', version: 1 },
  )
  const host = await render(createElement(RichTextViewer, { value, direction: 'rtl', t }))
  await act(async () => sleep(20))
  assert.equal(host.querySelectorAll('h2').length, 1, 'the heading is a heading')
  assert.equal(host.querySelector('h2')?.textContent, 'Quantum')
  assert.equal(host.querySelectorAll('li').length, 2, 'the list holds its two items')
  assert.equal(host.querySelector('strong')?.textContent, 'entanglement', 'and the bold run is bold')
  assert.equal(host.querySelectorAll('hr').length, 1, 'the rule is drawn by its React class, which the default views swap in')
  const hrefs = [...host.querySelectorAll('a')].map((anchor) => anchor.getAttribute('href'))
  assert.deepEqual(hrefs, ['about:blank', 'about:blank', 'https://example.com/'], 'a javascript: and a data: address are drawn as about:blank, and a page as itself')
  assert.equal(host.querySelector('[data-rich-text-view]')?.getAttribute('dir'), 'rtl', 'in the page\'s direction')

  // The project's own node, spread onto the defaults, through the context a screen provides: the same list the server parses with.
  const callout = richOf({ type: 'callout', tone: 'warning', version: 1, direction: null, format: '', indent: 0, children: [blockOf('paragraph', [textOf('Bring a pen')])] })
  const provided = { nodes: viewsOf([...defaultNodes, CalloutNode]), picks: defaultPicks }
  const own = await render(createElement(RichTextContext, { value: provided }, createElement(RichTextViewer, { value: callout, direction: 'ltr', t })))
  await act(async () => sleep(20))
  assert.equal(own.querySelector('aside[data-callout]')?.getAttribute('data-callout'), 'warning', 'the callout is drawn by its own class, with its state')
  assert.equal(own.querySelector('aside')?.textContent, 'Bring a pen', 'holding its words')
  assert.equal(own.querySelector('[role="alert"]') === null, true, 'and nothing is refused')
})

test('185g. a stored node no class of the screen registers is said in the viewer\'s language, drawn read-only as its words with the node marked, and its field is left out of every save', async () => {
  const { RichTextViewer, RichTextEditor } = await import('../registry/rich-text.tsx')
  const arabic: typeof t = (key, fallback) => (key === 'admin.richText.unknownNode' ? 'يحتوي هذا النص على عقدة "{type}" لا يستطيع هذا المحرر رسمها.' : t(key, fallback))
  const stored = richOf(blockOf('paragraph', [{ type: 'mention', version: 1, name: 'Huda', text: 'Huda' }, textOf(' joins')]), blockOf('heading', [textOf('Plan')], { tag: 'h2' }))
  for (const [translate, locale, words] of [[t, 'en', 'a "mention" node'], [arabic, 'ar', 'عقدة "mention"']] as const) {
    const viewed = await render(createElement(RichTextViewer, { value: stored, direction: locale === 'ar' ? 'rtl' : 'ltr', t: translate }))
    await act(async () => sleep(20))
    assert.equal(viewed.querySelector('[role="alert"]')?.textContent?.includes(words), true, `the viewer names the type in ${locale}: ${viewed.querySelector('[role="alert"]')?.textContent}`)
    assert.equal(viewed.querySelector('[data-unknown-node="mention"]')?.textContent, 'mention: Huda', 'the node is marked where it stands')
    assert.equal(viewed.textContent?.includes(' joins') && viewed.textContent.includes('Plan'), true, 'and every word around it is drawn')
    assert.equal(viewed.querySelectorAll('[contenteditable]').length, 0, 'with no editor mounted')
  }
  const changes: unknown[] = []
  const edited = await render(createElement(RichTextEditor, { value: stored, onChange: (next: unknown) => void changes.push(next), direction: 'ltr', t, locale: 'en', id: 'courses-details' }))
  await act(async () => sleep(20))
  assert.equal(edited.querySelector('[role="alert"]')?.textContent?.includes('a "mention" node'), true, 'the editor says the same')
  assert.equal(edited.querySelectorAll('[contenteditable]').length + edited.querySelectorAll('[aria-label="Bold"]').length, 0, 'and draws no editor and no toolbar')

  // A page save writes the fields that changed and never this one.
  const saved: Record<string, unknown>[] = []
  const page = recordPage([{ form: ['capacity', 'details'] }], '/sessions/:id')
  const host = await render(createElement(Form, {
    kayan: sessions, screen: screenOf(page, sessions),
    client: { create: async () => ({}), update: async (input: Record<string, unknown>) => (saved.push(input), {}), delete: async () => ({}) },
    value: { id: 's1', course: 'c1', capacity: 5, startsAt: new Date(2026, 0, 2, 3, 4).toISOString(), details: stored }, t, locale: 'en', onDone: () => {},
  }))
  await act(async () => sleep(20))
  assert.equal(host.querySelector('[data-unknown-node="mention"]') !== null, true, 'the form draws the stored value read-only')
  await act(async () => typeInto(host.querySelector('#sessions-capacity')!, '7'))
  await act(async () => fire(host.querySelector('form')!, 'submit'))
  assert.equal(saved.length, 1, 'the page still saves')
  assert.equal('details' in saved[0]!, false, `without the field it could not draw: ${JSON.stringify(saved[0])}`)
  assert.equal(changes.length, 0, 'and the editor reported nothing')
})

test('185d. Compare versions shows a change of a rich text value\'s format or link address as a change, and draws each side as its text on one line', async () => {
  const { Versions } = await import('../../../templates/asas/src/ui-dashboard/versions.tsx')
  const words = (text: string, format = 0) => richOf(blockOf('paragraph', [textOf(text, format)]))
  const linked = (url: string) => richOf(blockOf('paragraph', [{ type: 'link', version: 1, url, rel: null, target: null, title: null, direction: null, format: '', indent: 0, children: [textOf('Kept words')] }]))
  const richHistory = [
    // The same words, linked elsewhere: a change, though a reader sees the same text.
    { id: 'r4', latest: true, autosave: false, updatedAt: '2031-02-04T10:00:00.000Z', version: { title: 'Same', details: linked('https://example.com/b'), _status: 'draft' } },
    { id: 'r3', latest: false, autosave: false, updatedAt: '2031-02-03T10:00:00.000Z', version: { title: 'Same', details: linked('https://example.com/a'), _status: 'draft' } },
    // The same words made bold: a change of format.
    { id: 'r2', latest: false, autosave: false, updatedAt: '2031-02-02T10:00:00.000Z', version: { title: 'Same', details: words('Kept words', 1), _status: 'draft' } },
    { id: 'r1', latest: false, autosave: false, updatedAt: '2031-02-01T10:00:00.000Z', version: { title: 'Same', details: words('Kept words'), _status: 'published' } },
  ]
  const asked: Asked[] = []
  const host = await render(createElement(Versions, { page: undefined as never }), { client: historyClient(asked, undefined, richHistory), record: { id: 'a-row', updatedAt: '2031-02-04T10:00:00.000Z' }, access: reading, kayan: courses })
  await act(async () => sleep(0))
  await openVersion(host, 'r2')
  assert.deepEqual(diffRows(), ['details'], 'the same words made bold are a modified row')
  const row = sheet()?.querySelector('[data-diff="details"]')?.textContent ?? ''
  assert.equal(row.includes('Kept words') && !row.includes('paragraph'), true, `each side as its words: ${row}`)
  const marks = () => ['before', 'after'].map((side) => sheet()!.querySelectorAll(`[data-diff="details"] [data-${side}] [data-block-changed]`).length)
  assert.deepEqual(marks(), [1, 1], 'and the block whose format changed is marked on both sides')
  await openVersion(host, 'r4')
  assert.deepEqual(diffRows(), ['details'], 'and so is a link pointed elsewhere')
  assert.deepEqual(marks(), [1, 1], 'with its block marked on both sides')
})

test('276b. Compare marks the blocks of a rich text value the other side does not hold, and with every field shown the rows that differ say Changed', async () => {
  const { Versions } = await import('../../../templates/asas/src/ui-dashboard/versions.tsx')
  const doc = (...texts: string[]) => richOf(...texts.map((text) => blockOf('paragraph', [textOf(text)])))
  const richHistory = [
    { id: 'm2', latest: true, autosave: false, updatedAt: '2031-03-02T10:00:00.000Z', version: { title: 'Same', details: doc('Kept', 'Added'), _status: 'draft' } },
    { id: 'm1', latest: false, autosave: false, updatedAt: '2031-03-01T10:00:00.000Z', version: { title: 'Same', details: doc('Kept', 'Removed'), _status: 'published' } },
  ]
  const host = await render(createElement(Versions, { page: undefined as never }), { client: historyClient([], undefined, richHistory), record: { id: 'a-row', updatedAt: '2031-03-02T10:00:00.000Z' }, access: reading, kayan: courses })
  await act(async () => sleep(0))
  await openVersion(host, 'm2')
  const marked = (side: 'before' | 'after') => [...sheet()!.querySelectorAll(`[data-diff="details"] [data-${side}] [data-block-changed]`)].map((one) => `${one.tagName.toLowerCase()}:${one.textContent}`)
  assert.deepEqual(marked('before'), ['del:Removed'], 'the block the viewed version dropped is struck on the side compared against')
  assert.deepEqual(marked('after'), ['ins:Added'], 'and the block it added is inserted on the side viewed, the kept block unmarked')
  assert.equal(sheet()!.querySelector('[data-badge="changed"]'), null, 'modified only says nothing more than listing the row')
  await act(async () => {
    click(sheet()!.querySelector('[data-modified-only]')!)
  })
  assert.deepEqual([...sheet()!.querySelectorAll('[data-diff]')].map((one) => [one.getAttribute('data-diff'), one.hasAttribute('data-changed'), one.querySelector('[data-badge="changed"]')?.textContent ?? null]), [['title', false, null], ['details', true, 'Changed']], 'every field shown, only the one that differs is marked')
})

test('185e. a rich text cell is the words of the value\'s first block, cut where a cell runs out, and a record page reads the value whole through the viewer', async () => {
  const details = courses.fields.find((one) => one.name === 'details')!
  const cell = (value: unknown) => {
    const drawn = cells.richText!({ kayan: courses, field: details, value, t, locale: 'en' })
    return (drawn as ReactElement<{ children: string }>).props.children
  }
  const value = richOf(blockOf('paragraph', [textOf('Covers '), textOf('entanglement', 1), { type: 'linebreak', version: 1 }, textOf('and more')]), blockOf('heading', [textOf('Quantum')], { tag: 'h2' }))
  assert.equal(cell(value), 'Covers entanglement and more', 'the first block alone, a line break to a space, and a bold word inside its sentence')
  assert.equal(cell(richOf(blockOf('paragraph', []), blockOf('heading', [textOf('Quantum')], { tag: 'h2' }))), 'Quantum', 'an empty first block is passed over')
  assert.equal(cell(richOf(blockOf('paragraph', []), blockOf('paragraph', [{ type: 'linebreak', version: 1 }]))), '—', 'and a value whose every block is empty draws a dash')
  const drawn = cells.richText!({ kayan: courses, field: details, value, t, locale: 'en' }) as ReactElement<{ dir?: string }>
  assert.equal(drawn.props.dir, 'auto', 'and the line takes its direction from its own words')
  const long = cell(richOf(blockOf('paragraph', [textOf('word '.repeat(60))])))
  assert.equal([...long].length, 120, 'a long value is cut at 120 characters, the space it ends on dropped, and an ellipsis')
  assert.equal(long.endsWith('word…'), true)
  assert.equal(cell(null), '—', 'and nothing is a dash')

  const { FieldValue } = await import('../registry/field-value.tsx')
  const host = await render(createElement(FieldValue, { copy: { t, locale: 'en' }, field: details, kayan: courses, row: { id: 'c1', details: value } }))
  await act(async () => sleep(20))
  assert.equal(host.querySelector('[data-field-value="details"] h2')?.textContent, 'Quantum', 'the record page draws the heading as a heading')
  assert.equal(host.querySelector('[data-field-value="details"] strong')?.textContent, 'entanglement', 'and the bold word as bold')
})

test('185j. the editor makes a link only to an address the server takes, so a pasted or typed javascript:, data: or bare address never becomes one', async () => {
  const { RichTextEditor } = await import('../registry/rich-text.tsx')
  const { $getRoot } = await import('lexical')
  const { TOGGLE_LINK_COMMAND } = await import('@lexical/link')
  const host = await render(createElement(RichTextEditor, { value: richOf(blockOf('paragraph', [textOf('Read more here')])), onChange: () => {}, direction: 'ltr', t, locale: 'en', id: 'courses-details' }))
  await act(async () => sleep(20))
  // Lexical keeps its editor on the root element it draws into.
  const editor = (host.querySelector('#courses-details') as unknown as { __lexicalEditor: import('lexical').LexicalEditor }).__lexicalEditor
  const linkWord = async (url: string | null) => {
    // One update, so the selection is the one the command reads.
    await act(async () => editor.update(() => {
      $getRoot().getAllTextNodes()[0]!.select(0, 4)
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, url)
    }))
    // `LinkPlugin` answers this command for the toolbar and for a paste of an address over a selection alike, through the one check it is handed.
  }
  for (const url of ['javascript:alert(1)', 'data:text/html,<b>x</b>', 'example.com', 'https://', 'http:///courses', 'https://@', 'https://:', 'https://.', 'https://user@']) {
    await linkWord(url)
    assert.equal(host.querySelectorAll('#courses-details a').length, 0, `${url} never becomes a link`)
  }
  for (const url of ['https://example.com/a', '/courses', 'mailto:office@example.com']) {
    await linkWord(url)
    assert.equal(host.querySelector('#courses-details a')?.getAttribute('href'), url, `while ${url} does`)
  }
  await linkWord(null)
  assert.equal(host.querySelectorAll('#courses-details a').length, 0, 'and a link is removed')
})

test('185k. a stored value nested past the server\'s own bound is drawn read-only, cut at the bound, rather than running the page out of stack', async () => {
  const { RichTextViewer, RichTextEditor } = await import('../registry/rich-text.tsx')
  // Built in a loop, the way a value from elsewhere could be stored, two hundred thousand lists deep.
  let deep: Record<string, unknown> = textOf('deep')
  for (let at = 0; at < 200_000; at++) deep = blockOf('list', [deep], { listType: 'bullet' })
  const stored = richOf(blockOf('paragraph', [textOf('Shallow words')]), deep)
  for (const element of [
    createElement(RichTextViewer, { value: stored, direction: 'ltr', t }),
    createElement(RichTextEditor, { value: stored, onChange: () => {}, direction: 'ltr', t, locale: 'en', id: 'courses-details' }),
  ]) {
    const host = await render(element)
    await act(async () => sleep(20))
    assert.equal(host.querySelector('[role="alert"]')?.textContent?.includes('cannot read this text'), true, 'it says the editor cannot read it')
    assert.equal(host.textContent?.includes('Shallow words') && host.textContent.includes('…'), true, 'and draws its words to the bound')
    assert.equal(host.querySelectorAll('[contenteditable]').length, 0, 'with no editor mounted')
  }
})

test('185n. a rich text field with no value yet, absent, null or an empty root, mounts an empty editor that takes words, while a node no class registers still draws the fallback', async () => {
  const { RichTextEditor } = await import('../registry/rich-text.tsx')
  const { RichTextNodes } = await import('../../../templates/mithaq/src/ui/rich-text-nodes.tsx')
  for (const value of [undefined, null, richOf()]) {
    const changes: unknown[] = []
    const host = await render(createElement(RichTextNodes, null, createElement(RichTextEditor, { value, onChange: (next: unknown) => void changes.push(next), direction: 'ltr', t, locale: 'en', id: 'courses-details' })))
    await act(async () => sleep(20))
    assert.equal(host.querySelector('[role="alert"]'), null, `${JSON.stringify(value)} is not refused: ${host.querySelector('[role="alert"]')?.textContent}`)
    const editable = host.querySelector('#courses-details')
    assert.equal(editable?.getAttribute('contenteditable'), 'true', `${JSON.stringify(value)} mounts an editable editor`)
    const editor = (editable as unknown as { __lexicalEditor: import('lexical').LexicalEditor }).__lexicalEditor
    const { $getRoot, $createParagraphNode, $createTextNode } = await import('lexical')
    await act(async () => editor.update(() => void $getRoot().clear().append($createParagraphNode().append($createTextNode('First words')))))
    await act(async () => sleep(20))
    assert.equal(JSON.stringify(changes.at(-1)).includes('First words'), true, `and reports what is written into it: ${JSON.stringify(changes.at(-1))}`)
  }
  const unknown = await render(createElement(RichTextEditor, { value: richOf(blockOf('mystery', [textOf('Odd')])), onChange: () => {}, direction: 'ltr', t, locale: 'en', id: 'courses-details' }))
  await act(async () => sleep(20))
  assert.equal(unknown.querySelector('[role="alert"]') !== null, true, 'a node no class registers is still refused')
  assert.equal(unknown.querySelectorAll('[contenteditable]').length, 0, 'with no editor mounted')
})

test('185l. a list cell over a stored value nested past the server\'s own bound draws its words to the bound', () => {
  let deep: Record<string, unknown> = textOf('deep')
  for (let at = 0; at < 200_000; at++) deep = blockOf('list', [deep], { listType: 'bullet' })
  const details = courses.fields.find((one) => one.name === 'details')!
  const drawn = cells.richText!({ kayan: courses, field: details, value: richOf(blockOf('paragraph', [textOf('Shallow '), deep])), t, locale: 'en' }) as ReactElement<{ children: string }>
  assert.equal(drawn.props.children.startsWith('Shallow') && drawn.props.children.endsWith('…'), true, drawn.props.children.slice(0, 40))
  // The deep block second at the root: `richTextLine` walks it within the depth bound, and the cell draws the first worded block alone.
  const second = cells.richText!({ kayan: courses, field: details, value: richOf(blockOf('paragraph', [textOf('Shallow')]), deep), t, locale: 'en' }) as ReactElement<{ children: string }>
  assert.equal(second.props.children, 'Shallow', 'a deep block after the first worded one is walked to the bound and never drawn')
  const first = cells.richText!({ kayan: courses, field: details, value: richOf(deep, blockOf('paragraph', [textOf('Shallow')])), t, locale: 'en' }) as ReactElement<{ children: string }>
  assert.equal(first.props.children.endsWith('…'), true, 'and one first is cut at the bound')
})

test('185m. the placeholder a new link starts with is dropped once the link editor is no longer open on it, so it is never saved', async () => {
  const { RichTextEditor } = await import('../registry/rich-text.tsx')
  const { $getRoot, BLUR_COMMAND } = await import('lexical')
  const { $toggleLink } = await import('@lexical/link')
  const changes: unknown[] = []
  const host = await render(createElement(RichTextEditor, { value: richOf(blockOf('paragraph', [textOf('Read more here')])), onChange: (next: unknown) => void changes.push(next), direction: 'ltr', t, locale: 'en', id: 'courses-details' }))
  await act(async () => sleep(20))
  const editor = (host.querySelector('#courses-details') as unknown as { __lexicalEditor: import('lexical').LexicalEditor }).__lexicalEditor
  // What the toolbar's link button does: the placeholder over the selected word.
  const placeholder = async () => {
    await act(async () => editor.update(() => {
      $getRoot().getAllTextNodes()[0]!.select(0, 4)
      $toggleLink('https://')
    }))
    await act(async () => sleep(20))
  }
  const links = () => [...host.querySelectorAll('#courses-details a')].map((one) => one.getAttribute('href'))
  // happy-dom holds no DOM selection for Lexical, so whether the placeholder stands while the selection is in it is the browser check's to measure.
  await placeholder()
  await act(async () => editor.update(() => void $getRoot().selectEnd()))
  await act(async () => sleep(20))
  assert.deepEqual(links(), [], 'and is gone once the selection leaves it')
  await placeholder()
  await act(async () => void editor.dispatchCommand(BLUR_COMMAND, new window.FocusEvent('blur') as unknown as FocusEvent))
  await act(async () => sleep(20))
  assert.deepEqual(links(), [], 'and once the focus leaves the editor for anything but the link editor')
  const last = changes.at(-1) as { root: { children: { children: { type: string }[] }[] } }
  assert.equal(last.root.children[0]!.children.some((one) => one.type === 'link'), false, 'so the value the form saves holds no link')
})

test('215d. a link still holding the placeholder never reaches the form, so an autosave while the link editor is open sends none', async () => {
  const { RichTextEditor } = await import('../registry/rich-text.tsx')
  const { $getRoot } = await import('lexical')
  const { $toggleLink, TOGGLE_LINK_COMMAND } = await import('@lexical/link')
  const changes: string[] = []
  const host = await render(createElement(RichTextEditor, { value: richOf(blockOf('paragraph', [textOf('Read more here')])), onChange: (next: unknown) => void changes.push(JSON.stringify(next)), direction: 'ltr', t, locale: 'en', id: 'courses-details' }))
  await act(async () => sleep(20))
  const editor = (host.querySelector('#courses-details') as unknown as { __lexicalEditor: import('lexical').LexicalEditor }).__lexicalEditor
  await act(async () => editor.update(() => {
    $getRoot().getAllTextNodes()[0]!.select(0, 4)
    $toggleLink('https://')
  }))
  await act(async () => sleep(20))
  // happy-dom holds no DOM selection, so the placeholder is dropped right after it is made; the update that made it is the one that must not reach the form.
  assert.equal(changes.some((one) => one.includes('"url":"https://"')), false, 'no value the form is handed holds the placeholder')
  await act(async () => editor.update(() => {
    $getRoot().getAllTextNodes()[0]!.select(0, 4)
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, 'https://example.com/a')
  }))
  await act(async () => sleep(20))
  assert.equal(changes.at(-1)?.includes('"url":"https://example.com/a"'), true, 'while the confirmed link is handed on')
})

test('192a. the sheet\'s close button sits at the inline end and the header keeps its room, so in Arabic the X never covers the title', async () => {
  const { Versions } = await import('../../../templates/asas/src/ui-dashboard/versions.tsx')
  const host = await render(createElement(Versions, { page: undefined as never }), { client: historyClient([]), record: versionRecord, access: reading, kayan: versioned })
  await act(async () => sleep(0))
  await openVersion(host, 'v3')
  const close = sheet()?.querySelector('[data-slot="sheet-close"]')?.className ?? ''
  assert.equal(/(^| )end-2( |$)/.test(close) && /(^| )sm:end-4( |$)/.test(close) && !/(^| )(left|right)-4( |$)/.test(close), true, `the close button is placed by the inline end: ${close}`)
  assert.equal(/(^| )pe-12( |$)/.test(sheet()?.querySelector('[data-slot="sheet-header"]')?.className ?? ''), true, 'and the header keeps room for it')
})

test('217s. the Compare sheet draws one close button, the registry\'s own, named in the page\'s language', async () => {
  const { Versions } = await import('../../../templates/asas/src/ui-dashboard/versions.tsx')
  const arabic = (key: string, fallback?: string) => (key === 'admin.close' ? 'إغلاق' : fallback)
  const host = await render(createElement(Versions, { page: undefined as never }), { client: historyClient([]), record: versionRecord, access: reading, kayan: versioned, t: arabic, locale: 'ar', dir: 'rtl' })
  await act(async () => sleep(0))
  await openVersion(host, 'v3')
  const closes = [...(sheet()?.querySelectorAll('[data-slot="sheet-close"]') ?? [])]
  assert.equal(closes.length, 1, 'one close button')
  assert.equal(closes[0]?.textContent?.trim(), 'إغلاق', 'named in Arabic')
})

test('192b. the rich text toolbar sticks under the page header on a solid tint, and the card that holds the editor does not clip it', async () => {
  const { RichTextEditor } = await import('../registry/rich-text.tsx')
  const editor = await render(createElement(RichTextEditor, { value: richOf(blockOf('paragraph', [textOf('Words')])), onChange: () => {}, direction: 'ltr', t, locale: 'en', id: 'courses-details' }))
  await act(async () => sleep(20))
  const box = editor.querySelector('[data-rich-text]')!
  assert.equal(box.classList.contains('overflow-clip') && !box.classList.contains('overflow-hidden'), true, 'the editor clips with overflow-clip, because overflow-hidden is a scroll container and sticky never sticks inside it')
  assert.equal(box.querySelector('.sticky')?.className.includes('top-[var(--header-bar-height,var(--header-height'), true, 'its toolbar sticks below the header as the header measured itself, wrapped or not, not under it')
  assert.equal(box.querySelector('.sticky')?.className.includes('bg-[color-mix(') && !/bg-muted\/20/.test(box.querySelector('.sticky')?.className ?? ''), true, 'on a solid tint, so the text under it does not show through')
  const page = recordPage([{ form: ['capacity', 'details'] }], '/sessions/:id')
  const form = await render(createElement(Form, {
    kayan: sessions, screen: screenOf(page, sessions), client: { create: async () => ({}), update: async () => ({}), delete: async () => ({}) },
    value: { id: 's1', course: 'c1', capacity: 5, startsAt: new Date(2026, 0, 2, 3, 4).toISOString(), details: richOf(blockOf('paragraph', [textOf('Words')])) }, t, locale: 'en', onDone: () => {},
  }))
  await act(async () => sleep(20))
  const card = form.querySelector('[data-rich-text]')?.closest('[data-slot="card"]')
  assert.ok(card?.className.includes('overflow-visible'), 'the host card does not clip the sticky editor toolbar')
  assert.equal(form.querySelector('[data-rich-text]')?.closest('.overflow-hidden'), null, 'no ancestor clips the sticky toolbar')
})

test('214a. a relationship field whose held rows the server refuses names each one as a row the viewer cannot see, never by its raw id', async () => {
  const field = courses.fields.find((one) => one.name === 'tags')!
  const forbidden = async () => { throw Object.assign(new Error('Forbidden.'), { status: 403 }) }
  const chips = async (api: FindApi | undefined) => {
    const host = await render(createElement(RelationshipControl, {
      values: {}, setValue: () => {}, field, kayan: courses, client: kayans, api, id: 'courses-tags', t, value: ['t1', 't2'], readOnly: false, onChange: () => {},
    }))
    await act(async () => sleep(10))
    return [...host.querySelectorAll('[data-slot="combobox-chip"]')].map((one) => one.textContent?.trim())
  }
  // A set of which the viewer reads nothing says so once, in the one note and no chip each.
  const noted = async (api: FindApi | undefined) => {
    assert.deepEqual(await chips(api), [], 'no chip for a row nobody may see')
    return window.document.body.textContent?.split('Not available').length === 2
  }
  assert.equal(await noted({ tags: { find: forbidden } }), true, 'a 403 on the read names neither id, and says so once')
  assert.deepEqual(await chips(fakeApi({ tags: [{ id: 't1', name: 'Recitation' }] }).api), ['Recitation', 'Deleted'], 'a row the answer leaves out is gone, beside the one it named')
  assert.equal(await noted(undefined), true, 'and a target the screen does not cross reads the same')
})

test('214b. More is absent when no secondary operation is allowed, and exposes only permitted actions', async () => {
  const zone = async (operations: Record<string, boolean>) => {
    const host = await render(createElement(Form, {
      kayan: courses,
      screen: screenOf(panelled),
      client: { create: async () => ({}), update: async () => ({}), delete: async () => ({}), run: async () => ({}) },
      value: { id: 'a-row', title: 'Tajweed' },
      t,
      locale: 'en',
      onDone: () => {},
      operations,
    }))
    const trigger = host.querySelector('[aria-label="More actions"]')
    if (!trigger) return null
    await act(async () => click(trigger))
    return window.document.querySelector('[data-slot="popover-content"]')?.textContent ?? null
  }
  assert.equal(await zone({}), null, 'no danger zone for a viewer who may neither archive nor delete')
  assert.match((await zone({ delete: true })) ?? '', /Delete/, 'More exposes Delete for one who may delete')
})

test('214c. a relationship cell never draws its id: loading in the server render, settled with no screen around it, and a dash for a read that failed, beside the picker\'s same dash', async () => {
  const { RelationshipCell, useRelationshipTitles } = await import('../registry/relationship-cell.tsx')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const field = courses.fields.find((one) => one.name === 'tags')!
  const server = renderToStaticMarkup(createElement(RelationshipCell, { kayan: courses, field, value: ['t1'], t, locale: 'en' }))
  assert.ok(server.includes('Loading…') && !server.includes('t1'), `the server render: ${server}`)

  // No ScreenContext: no read cap to read, so nothing is asked and the cell settles rather than loading for good.
  const Bare = ({ api }: { api: FindApi }) => {
    const titles = useRelationshipTitles({ fields: [field], docs: [{ tags: ['t1'] }], context: { api, client: kayans, locale: 'en' } })
    return createElement(RelationshipCell, { kayan: courses, field, value: ['t1'], t, locale: 'en', titles })
  }
  const host = mount()
  const root = createRoot(host)
  await act(async () => root.render(createElement(Bare, { api: fakeApi({ tags: [{ id: 't1', name: 'Recitation' }] }).api })))
  await act(async () => sleep(10))
  assert.equal(host.textContent, 'Not available', 'with no screen the cell settles')
  await act(async () => root.unmount())

  const down = async () => { throw new Error('network') }
  const failed = await render(createElement(Bare, { api: { tags: { find: down } } }))
  await act(async () => sleep(10))
  assert.equal(failed.textContent, '—', 'a read that failed is a dash, not a refusal')
  const picker = await render(createElement(RelationshipControl, {
    values: {}, setValue: () => {}, field, kayan: courses, client: kayans, api: { tags: { find: down } }, id: 'courses-tags', t, value: ['t1'], readOnly: false, onChange: () => {},
  }))
  await act(async () => sleep(10))
  assert.deepEqual([...picker.querySelectorAll('[data-slot="combobox-chip"]')].map((one) => one.textContent?.trim()), ['—'], 'and the picker says the same')
})

test('219d. the role cell of the people list holds the role and no control, on every row, since the actions are the row\'s menu', async () => {
  const { BackofficeRole } = await import('../../../templates/asas/src/ui-backoffice/user-actions.tsx')
  const backoffice = asas.targets.backoffice.client
  const over = { screen: backoffice, access: { permissions: '*' as const }, locale: 'en', dir: 'ltr' as const }
  const cell = JSON.stringify(backoffice.kayan.user!.pages.list)
  assert.ok(cell.includes('user-actions.tsx#BackofficeRole') && cell.includes('"menu":"./src/ui-backoffice/user-actions.tsx#UserMenu"'), 'the role column draws the role, and the row menu the actions')
  for (const role of ['support', 'super_admin']) {
    const host = await render(createElement(BackofficeRole, { value: role }), over)
    assert.equal(host.querySelectorAll('button').length, 0, `a ${role} row has nothing to press in its role cell`)
    assert.equal(host.querySelectorAll('[data-slot="badge"]').length, 1, `and shows the role: ${host.textContent}`)
  }
})

test('220e. the updated line of a form left open is read again every minute, as Payload\'s document controls read theirs', async () => {
  mock.timers.enable({ apis: ['setInterval', 'Date'], now: Date.parse('2026-10-08T12:00:00Z') })
  try {
    const host = await render(createElement(Form, {
      kayan: courses,
      screen: screenOf(courses.pages.edit!),
      client: draftClient([]),
      value: { ...draftRow, updatedAt: '2026-10-08T11:59:30Z' },
      t,
      locale: 'en',
      onDone: () => {},
      onCancel: () => {},
      drafts: { status: 'published' },
    }), { record: draftRow })
    const line = () => host.querySelector('[data-updated]')?.textContent
    assert.equal(line(), 'Updated 30 seconds ago')
    await act(async () => {
      mock.timers.tick(60_000)
    })
    assert.equal(line(), 'Updated 1 minute ago', 'a minute on, the line says so without a reload')
  } finally {
    mock.timers.reset()
  }
})

test('220g. while a dialog, an alert dialog, a sheet or a drawer is open, everything Base UI marked outside it is inert but a live region, as outside a native modal dialog, a menu makes nothing inert, closing it clears only what was set, and stopping while one is open hands the page back', async () => {
  const { holdFocus } = await import('../registry/record-frame.tsx')
  const body = window.document.createElement('div')
  window.document.body.append(body)
  const app = window.document.createElement('div')
  app.innerHTML = '<nav><a href="/">Home</a></nav><section><button>Behind</button><span aria-live="polite">2 selected</span></section>'
  const ownInert = window.document.createElement('div')
  ownInert.setAttribute('inert', '')
  const portal = window.document.createElement('div')
  body.append(app, ownInert, portal)
  let stop = holdFocus(body as unknown as HTMLElement)
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
  const inert = (selector: string) => !!app.querySelector(selector)?.closest('[inert]')
  const open = async (slot: string) => {
    app.setAttribute('data-base-ui-inert', '')
    ownInert.setAttribute('data-base-ui-inert', '')
    portal.innerHTML = `<div role="dialog" data-slot="${slot}" data-open=""><button>Inside</button></div>`
    await settle()
  }
  try {
    // `sidebar` is the phone's sidebar sheet, which renames its popup.
    for (const slot of ['dialog-content', 'alert-dialog-content', 'sheet-content', 'sidebar', 'drawer-popup']) {
      // Base UI marks the page outside the popup, and the popup opens.
      await open(slot)
      assert.deepEqual([inert('nav a'), inert('section button')], [true, true], `the page behind an open ${slot} is inert`)
      assert.equal(inert('[aria-live]'), false, 'all but the live region, which still speaks')
      assert.equal(portal.closest('[inert]') ?? portal.querySelector('[inert]'), null, 'and the modal itself is not')
      portal.querySelector('[role=dialog]')!.removeAttribute('data-open')
      app.removeAttribute('data-base-ui-inert')
      ownInert.removeAttribute('data-base-ui-inert')
      await settle()
      assert.equal(app.querySelectorAll('[inert]').length + Number(app.hasAttribute('inert')), 0, `closing the ${slot} gives the page back`)
      assert.equal(ownInert.hasAttribute('inert'), true, 'and leaves an inert it did not set')
    }
    // The desktop sidebar carries the same slot and is never open, so it is no modal.
    app.setAttribute('data-base-ui-inert', '')
    portal.innerHTML = '<div data-slot="sidebar"><button>Nav</button></div>'
    await settle()
    assert.equal(app.querySelectorAll('[inert]').length, 0, 'the desktop sidebar makes nothing inert')
    // A menu marks the page as a modal does, and is no modal.
    app.setAttribute('data-base-ui-inert', '')
    portal.innerHTML = '<div role="menu" data-open=""><div role="menuitem">Item</div></div>'
    await settle()
    assert.equal(app.querySelectorAll('[inert]').length, 0, 'an open menu makes nothing inert')
    // The frame goes away under an open sheet: the next page is not left dead.
    await open('sheet-content')
    assert.equal(inert('nav a'), true)
    stop()
    stop = () => {}
    assert.equal(body.querySelectorAll('[inert]').length, 1, 'stopping while a modal is open clears every inert it set')
    assert.equal(ownInert.hasAttribute('inert'), true, 'and only those')
  } finally {
    stop()
    body.remove()
  }
})

test('220h. a dashboard page and a portal page each hold one main landmark: the shell\'s, and no form or layout inside it draws another', async () => {
  const edit = await render(createElement(Form, { kayan: courses, screen: screenOf(courses.pages.edit!), client: publishedClient([], []), value: draftRow, t, locale: 'en', onDone: () => {}, onCancel: () => {} }), { record: draftRow })
  assert.equal(edit.querySelectorAll('[data-shell="app"]').length, 1, 'the dashboard\'s shell is drawn')
  assert.equal(edit.querySelectorAll('main').length, 1, 'with one main')
  const bare = await render(createElement(Form, { kayan: courses, client: publishedClient([], []), value: draftRow, t, locale: 'en', onDone: () => {} }))
  assert.equal(bare.querySelectorAll('main').length, 0, 'a form drawn with no page draws none of its own, so the page around it holds the one')
  const { Page } = await import('../../../templates/asas/src/ui-portal/page.tsx')
  const { PortalTopShell } = await import('../../../templates/mithaq/src/ui/top-shell.tsx')
  const portal = await render(createElement(PortalTopShell, { regions: { header: null, nav: null, main: createElement(Page, { regions: { main: 'x' }, page: { path: '/courses' } as never }) } }))
  assert.equal(portal.querySelectorAll('main').length, 1, 'and a portal page, its layout inside its shell, holds one')
})

test('220i. the sidebar header draws the organizations the session came with, never a skeleton, and one organization is its name with nothing to open', async () => {
  const { AppShell } = await import('../../../templates/mithaq/src/ui/app-shell.tsx')
  const shell = (organizations?: { id: string; name: string }[]) =>
    render(createElement(AppShell, { regions: { primary: null, more: null, header: null, main: 'x' } }), { user: { name: 'Admin', email: 'admin@example.com', ...(organizations && { organizations, activeOrganizationId: 'b' }) } })
  const two = await shell([{ id: 'a', name: 'First org' }, { id: 'b', name: 'Second org' }])
  const header = () => two.querySelector('[data-slot="sidebar-header"]')!
  assert.equal(header().querySelectorAll('[data-slot="skeleton"]').length, 0, 'no skeleton in the first paint')
  assert.equal(header().querySelector('[aria-haspopup="menu"]')?.textContent?.includes('Second org'), true, 'the active organization names the switcher at once')
  const one = await shell([{ id: 'b', name: 'Only org' }])
  const only = one.querySelector('[data-slot="sidebar-header"]')!
  assert.equal(only.textContent?.includes('Only org'), true, 'one organization is named')
  assert.equal(only.querySelectorAll('button, [aria-haspopup]').length, 0, 'with no button or menu that switches to nothing')
})

// The link popover marks its address invalid only after an edit, which happy-dom cannot show: it keeps no selection for the popover to stay open on, so that one is measured in a browser.
const appTheme = 'mithaq-admin/theme.tsx'
const appUserMenu = 'mithaq-admin/nav-user.tsx'

test('231a. the rich text editor is named by its field\'s label, and is required when its field is', async () => {
  const page = recordPage([{ form: ['capacity', 'details'] }], '/sessions/:id')
  const form = await render(createElement(Form, {
    kayan: sessions, screen: screenOf(page, sessions), client: { create: async () => ({}), update: async () => ({}), delete: async () => ({}) },
    value: { id: 's1', course: 'c1', capacity: 5, startsAt: new Date(2026, 0, 2, 3, 4).toISOString(), details: richOf(blockOf('paragraph', [textOf('Words')])) }, t, locale: 'en', onDone: () => {},
  }))
  await act(async () => sleep(20))
  const editable = form.querySelector('[contenteditable="true"]')!
  const label = form.querySelector('label[for="sessions-details"]')!
  assert.equal(label.id !== '', true, 'the label has an id')
  assert.equal(editable.getAttribute('aria-labelledby'), label.id, 'and the editable names itself by it')
  const { RichTextControl } = await import('../registry/rich-text.tsx')
  const control = (required: boolean) => render(createElement(RichTextControl, {
    value: null, values: {}, setValue: () => {}, onChange: () => {}, field: fieldOf({ name: 'details', kind: 'richText', rules: required ? { required: true } : {} }), kayan: sessions, readOnly: false, id: 'sessions-details', t,
  }))
  const required = await control(true)
  await act(async () => sleep(20))
  assert.equal(required.querySelector('[contenteditable="true"]')?.getAttribute('aria-required'), 'true', 'a required field marks its editable aria-required')
  const optional = await control(false)
  await act(async () => sleep(20))
  assert.equal(optional.querySelector('[contenteditable="true"]')?.hasAttribute('aria-required'), false, 'and an optional one does not')
})

test('231b. the rich text toolbar is a named horizontal toolbar with one tab stop that the arrow keys move along, and the block format button\'s name holds the words it shows', async () => {
  const { RichTextEditor } = await import('../registry/rich-text.tsx')
  const draw = (direction: 'ltr' | 'rtl') => render(createElement(RichTextEditor, { value: richOf(blockOf('paragraph', [textOf('Words')])), onChange: () => {}, direction, t, locale: 'en', id: 'courses-details' }))
  const host = await draw('ltr')
  await act(async () => sleep(20))
  const bar = host.querySelector('[role="toolbar"]')!
  assert.equal(bar !== null, true, 'the toolbar is a toolbar')
  assert.equal(bar.getAttribute('aria-label'), 'Formatting', 'with a name')
  assert.equal(bar.getAttribute('aria-orientation'), 'horizontal', 'and an orientation')
  const buttons = () => [...bar.querySelectorAll('button')] as unknown as HTMLElement[]
  const stops = () => buttons().filter((one) => !one.hasAttribute('disabled') && one.getAttribute('tabindex') !== '-1')
  assert.equal(stops().length, 1, 'one tab stop for the whole toolbar')
  const enabled = () => buttons().filter((one) => !one.hasAttribute('disabled'))
  stops()[0]!.focus()
  await act(async () => press(window.document.activeElement as unknown as Element, 'ArrowRight'))
  assert.equal(window.document.activeElement, enabled()[1], 'the right arrow moves to the next button')
  assert.equal(stops().length === 1 && stops()[0] === enabled()[1], true, 'and the tab stop goes with it')
  await act(async () => press(window.document.activeElement as unknown as Element, 'End'))
  assert.equal(window.document.activeElement, enabled().at(-1), 'End goes to the last')
  await act(async () => press(window.document.activeElement as unknown as Element, 'ArrowRight'))
  assert.equal(window.document.activeElement, enabled()[0], 'and the right arrow wraps to the first')
  await act(async () => press(window.document.activeElement as unknown as Element, 'ArrowLeft'))
  assert.equal(window.document.activeElement, enabled().at(-1), 'the left arrow wraps back')
  const key = (init: Record<string, unknown>) => (window.document.activeElement as unknown as Element).dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }) as unknown as Event)
  const before = window.document.activeElement
  assert.equal(key({ key: 'Tab' }), true, 'Tab is left to the browser, so it leaves the toolbar')
  for (const init of [{ key: 'ArrowLeft', altKey: true }, { key: 'ArrowRight', metaKey: true }, { key: 'Home', ctrlKey: true }]) {
    assert.equal(key(init), true, `${JSON.stringify(init)} is not swallowed`)
    assert.equal(window.document.activeElement, before, 'and moves nothing')
  }
  // The button holding focus is disabled under it, as Undo is once nothing is left to undo.
  const held = enabled()[3] as HTMLButtonElement
  held.focus()
  held.disabled = true
  await act(async () => sleep(0))
  assert.equal(window.document.activeElement, buttons().slice(buttons().indexOf(held) + 1).find((one) => !one.hasAttribute('disabled')), 'focus goes to the next button, not to the page or the first button')
  assert.equal(stops().length === 1 && stops()[0] === window.document.activeElement, true, 'which is the tab stop')
  held.disabled = false
  // Focus that has left the toolbar is not pulled back by a later change to a button.
  const later = enabled()[2] as HTMLButtonElement
  later.focus()
  later.blur()
  later.disabled = true
  await act(async () => sleep(0))
  assert.equal(window.document.activeElement === window.document.body, true, 'focus that left the toolbar for the page stays there')
  later.disabled = false
  const block = buttons().find((one) => one.textContent?.includes('Paragraph'))!
  assert.equal(block.getAttribute('aria-label')?.includes('Paragraph'), true, 'the block format button\'s name holds the words it shows')
  const rtl = await draw('rtl')
  await act(async () => sleep(20))
  const rtlButtons = [...rtl.querySelectorAll('[role="toolbar"] button')].filter((one) => !one.hasAttribute('disabled')) as unknown as HTMLElement[]
  rtlButtons.find((one) => one.getAttribute('tabindex') !== '-1')!.focus()
  await act(async () => press(window.document.activeElement as unknown as Element, 'ArrowLeft'))
  assert.equal(window.document.activeElement, rtlButtons[1], 'and in a right-to-left editor the left arrow moves forward')
})

test('231c. the registry\'s sidebar is one named navigation landmark that holds the switcher, the links and the user menu', async () => {
  const { Shell } = await import('../registry/nav.tsx')
  const arabic = (key: string, fallback?: string) => (key === 'admin.navigation' ? 'التنقل' : fallback)
  const host = await render(createElement(Shell, {
    client: kayans, access: { collections: { courses: { read: true } } }, t: arabic, locale: 'ar', href: (kayan: { name: string }) => `/${kayan.name}`,
    user: { name: 'Admin', email: 'admin@example.com' }, organizations: [{ id: 'a', name: 'Acme' }], activeOrganizationId: 'a', onSwitchOrganization: () => {}, onSignOut: () => {},
  }))
  const navs = [...host.querySelectorAll('nav')].filter((one) => one.getAttribute('aria-label') === 'التنقل')
  assert.equal(navs.length, 1, 'one nav, named in the page\'s language')
  assert.deepEqual(['header', 'content', 'footer'].map((one) => navs[0]!.querySelector(`[data-slot="sidebar-${one}"]`) !== null), [true, true, true], 'holding the header, the content and the footer')
  assert.equal(host.querySelectorAll('[aria-label="التنقل"]').length, 1, 'and no list inside it carries the name again')
})

test('231i. the template\'s sidebar is one named navigation landmark holding its switcher, its links and its user menu', async () => {
  const host = await render(createElement(AppShell, { regions: { primary: null, more: null, header: null, main: 'x' } }), { user: { name: 'Admin', email: 'admin@example.com', organizations: [{ id: 'a', name: 'Acme' }], activeOrganizationId: 'a' } })
  const navs = [...host.querySelectorAll('[data-slot="sidebar"] nav[aria-label="Navigation"]')]
  assert.equal(navs.length, 1, 'one nav in the sidebar, named')
  assert.deepEqual(['header', 'content', 'footer'].map((one) => navs[0]!.querySelector(`[data-slot="sidebar-${one}"]`) !== null), [true, true, true], 'holding the header, the content and the footer')
  assert.equal(host.querySelectorAll('[aria-label="Navigation"]').length, 1, 'and no list inside it carries the name again')
  assert.equal(host.querySelectorAll('[role="region"]').length, 0, 'with no region of its own around the one organization\'s name')
})

test('231d. the portal\'s two navs are named differently', async () => {
  const { PortalTopShell } = await import('../../../templates/mithaq/src/ui/top-shell.tsx')
  const page = { path: '/courses/new', page: { shell: screen.layouts.app!, header: [{ title: {} }], main: [{ nav: {} }, { form: ['title'] }] } } as unknown as PageClient
  const body = createElement(Form, { kayan: courses, screen: screenOf(page), client: publishedClient([], []), value: null, t, locale: 'en', onDone: () => {}, onCancel: () => {} })
  const host = await render(createElement(PortalTopShell, { regions: { header: null, nav: body, main: null } }), { kayan: courses })
  // The page's tree names the dashboard's shell, which draws a sidebar of its own that no portal page has.
  const names = [...host.querySelectorAll('nav')].filter((one) => !one.closest('[data-slot="sidebar"]')).map((one) => one.getAttribute('aria-label'))
  assert.equal(names.length, 2, `the shell\'s nav and the page\'s nav are both drawn: ${names.join(', ')}`)
  assert.equal(new Set(names).size, 2, `and no two share a name: ${names.join(', ')}`)
})

test('231e. the organization switcher marks the current organization with a radio item, draws no empty box beside the others, and is 44 pixels on a phone', async () => {
  await stubbed(async (calls) => {
    const host = await render(createElement(AppShell, { regions: { primary: null, more: null, header: null, main: 'x' } }), { user: { name: 'Admin', email: 'admin@example.com', organizations: [{ id: 'a', name: 'First org' }, { id: 'b', name: 'Second org' }], activeOrganizationId: 'b' } })
    await act(async () => click(host.querySelector('[data-slot="sidebar-header"] [data-slot="dropdown-menu-trigger"]')!))
    const radios = [...window.document.querySelectorAll('[role="menuitemradio"]')]
    assert.deepEqual(radios.map((one) => [one.textContent, one.getAttribute('aria-checked')]), [['First org', 'false'], ['Second org', 'true']], 'the current one is checked, the other is not')
    assert.equal(radios.some((one) => one.querySelector('.border') !== null), false, 'and no row draws a bordered box that reads as an unticked checkbox')
    assert.equal(radios.every((one) => classesOf(one as unknown as Element).includes('min-h-11')), true, 'each row is 44 pixels on a phone')
    await act(async () => click(radios[0] as unknown as Element))
    await act(async () => sleep(0))
    assert.ok(calls.includes('POST /api/auth/user/organization/set-active'), `choosing another posts the switch: ${calls.join(', ')}`)
  })
})

test('229e. two organizations of one name are told apart in the switcher by their slugs, and a name that does not repeat shows none', async () => {
  await stubbed(async () => {
    const organizations = [{ id: 'a', name: 'Admin org', slug: 'admin-org-a1' }, { id: 'b', name: 'Admin org', slug: 'admin-org-b2' }, { id: 'c', name: 'Other', slug: 'other-c3' }]
    const host = await render(createElement(AppShell, { regions: { primary: null, more: null, header: null, main: 'x' } }), { user: { name: 'Admin', email: 'admin@example.com', organizations, activeOrganizationId: 'b' } })
    assert.equal(host.querySelector('[data-slot="sidebar-header"] [data-slug]')?.textContent, 'admin-org-b2', 'the active one carries its slug')
    await act(async () => click(host.querySelector('[data-slot="sidebar-header"] [data-slot="dropdown-menu-trigger"]')!))
    const rows = [...window.document.querySelectorAll('[role="menuitemradio"]')].map((one) => one.querySelector('[data-slug]')?.textContent ?? null)
    assert.deepEqual(rows, ['admin-org-a1', 'admin-org-b2', null], 'and so does each row whose name repeats')
  })
})

test('231f. the user menu offers Light, Dark and System as radio items, marks the stored one, and sets the class and the stored key the first paint reads', async () => {
  const { ThemeProvider } = await import(appTheme)
  window.localStorage.setItem('vite-ui-theme', 'light')
  const host = await render(createElement(ThemeProvider, { defaultTheme: 'system', storageKey: 'vite-ui-theme', children: createElement(AppShell, { regions: { primary: null, more: null, header: null, main: 'x' } }) }))
  await act(async () => click(host.querySelector('[data-slot="sidebar-footer"] [data-slot="dropdown-menu-trigger"]')!))
  const themes = () => [...window.document.querySelectorAll('[role="menuitemradio"]')].map((one) => [one.textContent, one.getAttribute('aria-checked')])
  assert.deepEqual(themes(), [['Light', 'true'], ['Dark', 'false'], ['System', 'false']], 'the stored theme is the checked one')
  const dark = [...window.document.querySelectorAll('[role="menuitemradio"]')].find((one) => one.textContent === 'Dark')!
  await act(async () => click(dark as unknown as Element))
  await act(async () => sleep(0))
  assert.equal(window.localStorage.getItem('vite-ui-theme'), 'dark', 'choosing Dark stores it under the key the head script reads')
  assert.equal(window.document.documentElement.classList.contains('dark'), true, 'and puts the class on the document')
  window.localStorage.removeItem('vite-ui-theme')
  window.document.documentElement.classList.remove('dark', 'light')
})

test('231g. a person who may enter another screen finds a link to it in the user menu, and one who may enter no other finds none', async () => {
  const items = async (screens?: { name: string; path: string }[]) => {
    const named = (key: string, fallback?: string) => (key === 'screens.portal' ? 'Portal' : fallback)
    const host = await render(createElement(AppShell, { regions: { primary: null, more: null, header: null, main: 'x' } }), { t: named, user: { name: 'Admin', email: 'admin@example.com', ...(screens && { screens }) } })
    await act(async () => click(host.querySelector('[data-slot="sidebar-footer"] [data-slot="dropdown-menu-trigger"]')!))
    const links = [...window.document.querySelectorAll('[role="menuitem"]')].filter((one) => one.getAttribute('href') !== null).map((one) => [one.textContent, one.getAttribute('href')])
    await act(async () => press(window.document.body as unknown as Element, 'Escape'))
    return links
  }
  assert.deepEqual(await items([{ name: 'portal', path: '/portal' }]), [['Portal', '/portal']], 'the portal, named in the page\'s language')
  assert.deepEqual(await items(), [], 'and none where the host lists none')
})

test('231h. the theme group is drawn only where a provider keeps the choice and the project has not emptied `themes`, and offers the themes it is given', async () => {
  const { ThemeProvider } = await import(appTheme)
  const { NavUserMenu } = await import(appUserMenu)
  const { SidebarProvider } = await import('../registry/ui/sidebar.tsx')
  const menu = async (themes?: readonly string[], provide = true) => {
    const inner = createElement(SidebarProvider, null, createElement(NavUserMenu, { user: { name: 'Admin', email: 'admin@example.com' }, t, onSignOut: () => {}, ...(themes && { themes }) }))
    const host = await render(provide ? createElement(ThemeProvider, { defaultTheme: 'system', storageKey: 'vite-ui-theme', children: inner }) : inner)
    await act(async () => click(host.querySelector('[data-slot="dropdown-menu-trigger"]')!))
    const radios = [...window.document.querySelectorAll('[role="menuitemradio"]')].map((one) => one.textContent)
    await act(async () => press(window.document.body as unknown as Element, 'Escape'))
    return radios
  }
  assert.deepEqual(await menu(), ['Light', 'Dark', 'System'], 'all three by default')
  assert.deepEqual(await menu(['dark', 'light']), ['Light', 'Dark'], 'only those it is given')
  assert.deepEqual(await menu([]), [], 'none when emptied')
  assert.deepEqual(await menu(undefined, false), [], 'and none with no provider above it')
})

const rendered = (host: Element) => host.innerHTML.replace(/\s+/g, ' ')

test('233a. a fee reads in a left-to-right isolate, so Arabic never reorders its currency, and a fee nobody set reads as a dash', async () => {
  const { FeeCell } = await import('../../../templates/features/courses/courses/ui/fee-cell.tsx')
  const field = courses.fields.find((one) => one.name === 'fee')!
  const draw = async (value: unknown, row: Record<string, unknown>, locale: string) => rendered(await render(createElement(FeeCell, { field, value, row } as never), { locale }))
  assert.match(await draw(900, { currency: 'USD' }, 'ar'), /^<bdi dir="ltr">.*US\$.*<\/bdi>$/, 'a priced fee in Arabic')
  assert.match(await draw(900, { currency: 'USD' }, 'en'), /^<bdi dir="ltr">/, 'and in English')
  assert.match(await draw(900, {}, 'ar'), /^<bdi dir="ltr">/, 'and a fee with no currency')
  assert.equal(await draw(null, { currency: 'USD' }, 'en'), '<span aria-hidden="true">—</span>', 'no fee is a dash a reader of a screen is not told')
})

test('233b. an enrollment with no session reads as a dash, and a session\'s start never breaks across lines', async () => {
  const { SessionCell } = await import('../../../templates/features/courses/enrollments/ui/session-cell.tsx')
  const field = enrollments.fields.find((one) => one.name === 'session')!
  const queries = new QueryClient()
  const none = await render(createElement(QueryClientProvider, { client: queries }, createElement(SessionCell, { field, value: null, row: { id: 'e1' } } as never)), { client: (async () => pageOf([])) as never, kayan: enrollments })
  assert.equal(rendered(none), '<span aria-hidden="true">—</span>')
  await release(queries)

  const held = new QueryClient()
  const client = async ({ kayan }: { kayan: string }) => pageOf(kayan === 'sessions' ? [{ id: 's1', course: 'c1', startsAt: '2026-10-01T09:00:00.000Z' }] : [{ id: 'c1', title: 'Tajweed' }])
  const some = await render(createElement(QueryClientProvider, { client: held }, createElement(SessionCell, { field, value: 's1', row: { id: 'e1', session: 's1' } } as never)), { client: client as never, kayan: enrollments })
  await act(async () => sleep(20))
  assert.equal(some.querySelector('bdi')?.className.includes('whitespace-nowrap'), true, `the start is one unbroken run: ${rendered(some)}`)
  await release(held)

  const placed = new QueryClient()
  const where = async ({ kayan }: { kayan: string }) => pageOf(kayan === 'sessions' ? [{ id: 's1', course: 'c1', startsAt: '2026-10-01T09:00:00.000Z', venue: 'campus', format: 'workshop' }] : [{ id: 'c1', title: 'Tajweed' }])
  const both = await render(createElement(QueryClientProvider, { client: placed }, createElement(SessionCell, { field, value: 's1', row: { id: 'e1', session: 's1' } } as never)), { client: where as never, kayan: enrollments })
  await act(async () => sleep(20))
  assert.match(both.textContent ?? '', /Tajweed.*Campus · Workshop/, 'the session reads where and how it meets, in the viewer\'s words')
  await release(placed)
})

test('233c. a session in the picker holds its start together, so a narrow box breaks between the course and the date and never inside the date', async () => {
  const { SessionLabels } = await import('../../../templates/features/courses/enrollments/ui/session-labels.tsx')
  const { RelationshipControl } = await import('mithaq-admin/relationship-control.tsx')
  const { api } = fakeApi({ sessions: [{ id: 's1', course: 'c1', startsAt: '2026-10-12T09:00:00.000Z' }] })
  const client = async ({ kayan }: { kayan: string }) => pageOf(kayan === 'courses' ? [{ id: 'c1', title: 'Tajweed' }] : [])
  const queries = new QueryClient()
  const host = await render(createElement(QueryClientProvider, { client: queries }, createElement(SessionLabels, null, createElement(RelationshipControl, {
    values: {}, setValue: () => {}, field: enrollments.fields.find((one) => one.name === 'session')!, kayan: enrollments, client: kayans, api, id: 'enrollments-session', t, locale: 'en', value: undefined, readOnly: false, onChange: () => {},
  }))), { client: client as never })
  await act(async () => click(host.querySelector('#enrollments-session') as unknown as Element))
  await act(async () => sleep(30))
  const label = opened()!.querySelector('[data-slot="combobox-item"]')!.textContent ?? ''
  const [course, when] = label.split(' · ')
  assert.equal(course, 'Tajweed')
  assert.ok(when!.includes('2026') && !when!.includes(' '), `no space the date could break at: ${JSON.stringify(when)}`)
  queries.clear()
})

test('233d. a row with no title reads as Untitled in the list and names its link by what it shows and does, and a titled row keeps its title as its name', async () => {
  const draw = (title: unknown) => render(listOn(courses, [{ ...draftRow, id: 'x1', title }]))
  const empty = await draw('')
  const link = empty.querySelector('a[data-row-link]')!
  assert.equal(link.textContent, 'Untitled', 'the cell says so')
  assert.equal(link.querySelector('.text-muted-foreground')?.textContent, 'Untitled', 'muted')
  assert.equal(link.getAttribute('aria-label'), 'Untitled, open', 'the link\'s name holds the words it shows and says what it does')
  assert.equal((await draw(null)).querySelector('a[data-row-link]')?.getAttribute('aria-label'), 'Untitled, open', 'a null title as well')
  const titled = (await draw('Tajweed')).querySelector('a[data-row-link]')!
  assert.deepEqual([titled.textContent, titled.getAttribute('aria-label')], ['Tajweed', null], 'a title names its own link')
})

test('233e. a record with no title is headed Untitled, muted, whether its title is null, blank or missing', async () => {
  const { pageOf: drawPage } = await import('../registry/nodes.tsx')
  const shell = ({ regions }: { regions: Record<string, ReactElement> }) => createElement('div', null, regions.header)
  const heading = async (record: Record<string, unknown> | undefined) => {
    const page = { refs: { [screen.layouts.app!]: shell } as never, kayan: courses, page: courses.pages.edit as Extract<PageClient, { page: unknown }> }
    const host = await render(createElement('div', null, drawPage(page, { kayan: courses, copy: { t, locale: 'en' }, issues: {}, scope: record ? { record } : {}, component: () => null, layout: () => null, control: () => null })))
    return host.querySelector('[data-node="title"]')
  }
  const empty = await heading({ id: 'x1', title: '' })
  assert.equal(empty?.textContent, 'Untitled')
  assert.equal(empty?.querySelector('.text-muted-foreground')?.textContent, 'Untitled', 'muted')
  assert.equal((await heading({ id: 'x1', title: null }))?.textContent, 'Untitled', 'a null title as well')
  assert.equal((await heading({ id: 'x1', title: 'Tajweed' }))?.textContent, 'Tajweed')
  assert.equal((await heading({ id: 'x1' }))?.textContent, 'Untitled', 'a draft snapshot that lacks the key reads as untitled too, since a column the reader may not read is not a field of the kayan at all')
  assert.equal((await heading({ id: 'x1', title: '  ' }))?.textContent, 'Untitled', 'and so does a blank one')
  assert.notEqual((await heading({ id: 'x1', title: 'x1' }))?.textContent, 'Untitled', 'a title that happens to equal the row\'s id is a title')
})

test('233f. a list\'s Status says what the header says: Draft, Published, Changed for a published course whose newest version is a draft, and Archived over any of them', async () => {
  const { StatusCell } = await import('../../../templates/features/courses/courses/ui/status-cell.tsx')
  const path = courses.fields.find((one) => one.name === '_status')!.cell
  const rows = [
    { ...draftRow, id: 'p', title: 'Published', _status: 'published' },
    { ...draftRow, id: 'c', title: 'Changed', _status: 'draft' },
    { ...draftRow, id: 'd', title: 'Draft', _status: 'draft' },
    { ...draftRow, id: 'a', title: 'Archived', _status: 'published', archived: true },
  ]
  const reads: Record<string, unknown>[] = []
  // The plain read finds the rows that have a published copy, p and c.
  const client = async ({ kayan, input, draft }: { kayan: string; input: { where: { id: { in: string[] } } }; draft?: boolean }) => {
    reads.push({ kayan, draft, ids: input.where.id.in })
    return pageOf(['p', 'c'].filter((id) => input.where.id.in.includes(id)).map((id) => ({ id })))
  }
  const queries = new QueryClient()
  const list = listOn(courses, rows, { screen: screenOf(courses.pages.list!, courses, { [path]: StatusCell }) })
  const host = await render(createElement(QueryClientProvider, { client: queries }, createElement(ListContext, { value: list.props as never }, list)), { client: client as never })
  await act(async () => sleep(20))
  const status = (id: string) => host.querySelector(`tr[data-row="${id}"] [data-status]`)?.textContent
  assert.deepEqual(['p', 'c', 'd', 'a'].map(status), ['Published', 'Changed', 'Draft', 'Archived'])
  assert.deepEqual(reads, [{ kayan: 'courses', draft: undefined, ids: ['c', 'd'] }], 'one plain read of the draft rows alone, for the whole page')
  await release(queries)
})

test('233g. a rich text cell and an upload cell with nothing in them draw a dash', async () => {
  const draw = async (kind: 'richText' | 'upload', value: unknown) =>
    rendered(await render(createElement('span', null, cells[kind]!({ kayan: courses, field: courses.fields.find((one) => one.cell === kind)!, value, t, locale: 'en' }))))
  for (const kind of ['richText', 'upload'] as const) {
    for (const value of [null, undefined, []]) assert.equal(await draw(kind, value), '<span><span aria-hidden="true">—</span></span>', `${kind} holding ${JSON.stringify(value)}`)
  }
  assert.equal(await draw('richText', richOf(blockOf('paragraph', []))), '<span><span aria-hidden="true">—</span></span>', 'and a value whose every block is empty')
})

test('233h. the compare sheet offers no restore on the version the row already holds, dates the version it compares against, and still restores the others', async () => {
  const { Versions } = await import('../../../templates/asas/src/ui-dashboard/versions.tsx')
  const host = await render(createElement(Versions, { page: undefined as never }), { client: historyClient([]), record: versionRecord, access: restoring, kayan: versioned })
  await act(async () => sleep(0))
  const offered = () => [!!sheet()?.querySelector('[data-button="restore"]'), !!sheet()?.querySelector('[data-button="restore-as-draft"]')]
  await openVersion(host, 'v4')
  assert.equal(sheet()?.textContent?.includes('Currently published'), true, 'v4 is the version the row holds')
  assert.deepEqual(offered(), [false, false], 'a restore of it would add a version and change nothing, so neither button is offered')
  await openVersion(host, 'v3')
  assert.deepEqual(offered(), [true, false], 'a draft is restored')
  await openVersion(host, 'v1')
  assert.deepEqual(offered(), [true, true], 'and an older published version, as a draft too')
  await openVersion(host, 'v5')
  assert.match(sheet()!.querySelector('[data-slot="select-trigger"]')!.textContent ?? '', /^Previous version · .*2031/, 'the select names the version it compares against by its date')
})

test('233i. a set whose every row the viewer may not read says so once, and a set of some keeps a chip for each', async () => {
  const tags = courses.fields.find((field) => field.name === 'tags')!
  const changes: unknown[] = []
  const draw = async (rows: Record<string, unknown>[] | 'forbidden') => {
    const api = rows === 'forbidden' ? { tags: { find: async () => { throw Object.assign(new Error('Forbidden.'), { status: 403 }) } } } : fakeApi({ tags: rows }).api
    const host = await render(createElement(RelationshipControl, { field: tags, values: {}, setValue: () => {}, kayan: courses, client: kayans, api, id: 'courses-tags', t, value: ['t1', 't2', 't3'], readOnly: false, onChange: (next: unknown) => changes.push(next) }))
    await act(async () => sleep(30))
    return host
  }
  const refused = await draw('forbidden')
  assert.equal(refused.textContent?.split('Not available').length, 2, `one note: ${refused.textContent}`)
  assert.equal(refused.querySelectorAll('[data-slot="combobox-chip"]').length, 0, 'and no chip for each')
  // Backspace in the empty box takes the last chip off a set, and here the chips are not drawn, so it would drop a tag nobody sees.
  await act(async () => press(refused.querySelector('#courses-tags') as unknown as Element, 'Backspace'))
  assert.deepEqual(changes, [], 'it changes nothing')
  const some = await draw([{ id: 't1', name: { en: 'Weekend' } }])
  await act(async () => press(some.querySelector('#courses-tags') as unknown as Element, 'Backspace'))
  assert.deepEqual(changes.at(-1), ['t1', 't2'], 'where each chip is drawn Backspace still takes the last off')
  assert.equal(some.querySelectorAll('[data-slot="combobox-chip"]').length, 3, 'a set of which the viewer reads one keeps a chip for each of the three')
  assert.equal(some.textContent?.split('Deleted').length, 3, 'two of them said they are gone')
})

test('233j. the user menu asks before it switches the language over a form holding a change, in the app\'s own dialog, and switches at once over none', async () => {
  const reloads: number[] = []
  const reload = window.location.reload
  Object.defineProperty(window.location, 'reload', { configurable: true, value: () => reloads.push(1) })
  const chooseArabic = async () => {
    const host = await render(createElement(AppShell, { regions: { primary: null, more: null, header: null, main: 'x' } }), { user: { name: 'Admin', email: 'admin@example.com' } })
    await act(async () => click(host.querySelector('[data-slot="sidebar-footer"] [data-slot="dropdown-menu-trigger"]')!))
    await act(async () => click([...window.document.querySelectorAll('[role="menuitem"]')].find((one) => one.textContent?.includes('العربية')) as unknown as Element))
  }
  const dialog = () => window.document.querySelector('[data-slot="alert-dialog-content"]')
  try {
    window.document.cookie = 'locale=en; Path=/'
    window.onbeforeunload = () => ''
    await chooseArabic()
    assert.equal(dialog()?.textContent?.includes('Discard changes'), true, 'a held change is asked about in the app\'s own dialog')
    assert.deepEqual([reloads.length, /locale=en/.test(window.document.cookie), typeof window.onbeforeunload], [0, true, 'function'], 'and nothing has changed yet')
    await act(async () => click([...dialog()!.querySelectorAll('button')].find((one) => one.textContent === 'Cancel') as unknown as Element))
    assert.deepEqual([reloads.length, /locale=en/.test(window.document.cookie), typeof window.onbeforeunload], [0, true, 'function'], 'Cancel changes neither the form nor the language')
    await chooseArabic()
    await act(async () => click([...dialog()!.querySelectorAll('button')].find((one) => one.textContent === 'Discard changes') as unknown as Element))
    assert.deepEqual([reloads.length, /locale=ar/.test(window.document.cookie), window.onbeforeunload], [1, true, null], 'Discard switches, and drops the guard so the browser does not ask again')

    window.document.cookie = 'locale=en; Path=/'
    await chooseArabic()
    assert.deepEqual([dialog() === null, reloads.length, /locale=ar/.test(window.document.cookie)], [true, 2, true], 'with no change held it switches without a question')
  } finally {
    window.onbeforeunload = null
    Object.defineProperty(window.location, 'reload', { configurable: true, value: reload })
  }
})

test('233k. the upcoming sessions fold the venue and the capacity under the course below sm, and the columns return from sm', async () => {
  const upcoming = [{ id: 's1', course: 'Tajweed', startsAt: '2031-01-01T09:00:00.000Z', venue: 'campus', capacity: 20 }, { id: 's2', course: 'Tafsir', startsAt: '2031-01-02T09:00:00.000Z' }]
  const host = await render(createElement(Dashboard, { loaderData: { courses: 1, open: 1, upcoming } }), { kayan: undefined })
  const rows = [...host.querySelectorAll('[data-home-table="sessions"] tbody tr')]
  const folded = (row: Element) => row.querySelector('td:first-child .sm\\:hidden')?.textContent ?? null
  assert.equal(folded(rows[0]!), 'Campus · Capacity: 20', 'the venue and the capacity under the course\'s name')
  assert.equal(folded(rows[1]!), null, 'and nothing where a session has neither')
  const heads = [...host.querySelectorAll('[data-home-table="sessions"] th')].map((one) => [one.textContent, one.classList.contains('hidden'), one.classList.contains('sm:table-cell')])
  assert.deepEqual(heads, [['Course', false, false], ['Starts at', false, false], ['Venue', true, true], ['Capacity', true, true]], 'the two columns are hidden below sm')
  assert.deepEqual([...rows[0]!.querySelectorAll('td')].map((one) => [one.classList.contains('hidden'), one.classList.contains('sm:table-cell')]), [[false, false], [false, false], [true, true], [true, true]])
})

test('233l. a session\'s Enrollments tab is drawn, and its list read, only for an actor the report lets read enrollments', async () => {
  const { scopeOf, shown } = await import('../registry/node-tree.ts')
  const edit = sessions.pages.edit as Extract<PageClient, { page: unknown }>
  const tabs = ((edit.page.main as unknown as { main: { tabs: { tab: string; fields: { when?: object }[] }[] }[] }[])[0]!.main[0]!).tabs
  const tab = tabs.find((one) => one.tab === 'enrollments')!
  assert.equal(tab.fields.length, 1)
  const when = tab.fields[0]!.when!
  const holds = (collections: Record<string, unknown>) => shown(tab.fields[0] as never, scopeOf({ values: {}, record: {}, access: { collections }, kayan: sessions }))
  assert.equal(JSON.stringify(when), '{"$user.collections.enrollments.operations.find":{"equals":true}}')
  assert.equal(holds({ enrollments: { operations: { find: true } } }), true, 'a reader of enrollments')
  assert.equal(holds({ enrollments: { operations: { find: false } } }), false, 'one the report refuses')
  assert.equal(holds({}), false, 'and one the report leaves them out for, the registrar')

  // The tab strip leaves the tab out, and the host reads no list of it.
  const { pageOf: drawPage, frameOf } = await import('../registry/nodes.tsx')
  const { nodesOf, relatedIn } = await import('../registry/node-tree.ts')
  const shell = ({ regions }: { regions: Record<string, ReactElement> }) => createElement('div', null, regions.header, regions.main)
  const tabsFor = async (collections: Record<string, unknown>) => {
    const page = { refs: { [screen.layouts.app!]: shell, [screen.layouts.record!]: RecordPage } as never, kayan: sessions, page: edit }
    const copy = { t, locale: 'en' }
    const row = { id: 's1', course: 'c1' }
    const host = await render(createElement('div', null, drawPage(page, {
      kayan: sessions, copy, issues: {}, scope: scopeOf({ values: {}, record: row, access: { collections }, kayan: sessions }), component: () => null, control: () => null,
      layout: ({ path, regions, index }) => frameOf({ screen: page, t: copy.t, path, regions, key: index }),
    })), { kayan: sessions, record: row })
    return [...host.querySelectorAll('[role="tab"]')].map((one) => one.textContent)
  }
  assert.deepEqual(await tabsFor({ enrollments: { operations: { find: true } } }), ['Details', 'Enrollments'], 'a reader of enrollments has the tab')
  assert.deepEqual(await tabsFor({}), ['Details'], 'a registrar has none')
  const scope = (collections: Record<string, unknown>) => scopeOf({ values: {}, record: { id: 's1' }, access: { collections }, kayan: sessions })
  assert.deepEqual(relatedIn(nodesOf(edit as never), scope({ enrollments: { operations: { find: true } } })).map((one) => one.of), ['enrollments'], 'the host reads the list for a reader of it')
  assert.deepEqual(relatedIn(nodesOf(edit as never), scope({ enrollments: { operations: { find: false } } })).map((one) => one.of), [], 'and no list whose `when` fails, whose read the server would only refuse')
  assert.equal(relatedIn(nodesOf(edit as never)).length, 1, 'a call with no scope still lists every one')
})

/** A client over a published copy of each course, the latest draft of the same rows and a course nobody has published, as a draft read answers them. */
const draftedCourses = (access: import('mithaq/admin').AccessReport) => {
  const published = [{ id: 'a', fee: 100, currency: 'SAR', archived: false }, { id: 'b', fee: 50, currency: 'USD', archived: true }]
  const drafts = [...published, { id: 'c', fee: 25, currency: 'SAR', archived: false }]
  const asked: { kayan: string; operation: string; input: Record<string, unknown>; draft?: boolean }[] = []
  const tools = {
    asked,
    access,
    request: fetch,
    maxLimit: screen.maxLimit,
    client: (async (call: { kayan: string; operation: string; input: Record<string, unknown>; draft?: boolean }) => {
      asked.push(call)
      if (call.kayan !== 'courses') return { docs: [], totalDocs: 0, totalPages: 1 }
      const docs = call.draft ? drafts : published
      return call.operation === 'count' ? { totalDocs: published.length } : { docs, totalDocs: docs.length, totalPages: 1 }
    }) as ScreenState['client'],
  }
  return tools
}
const priced = { read: true, fields: { fee: { read: true }, currency: { read: true } } }

test('233m. the Courses card counts the rows the list lists: the draft read, a never-published course among them, for a reader of drafts, and the published rows for one who is not', async () => {
  const drafting = draftedCourses({ collections: { courses: { ...priced, operations: { find: true, findVersions: true } } } })
  const figures = await dashboardLoader(drafting)
  assert.deepEqual([figures.courses, figures.open], [3, 2], 'the list reads the latest draft of every row, so the card counts three, and the two not archived over the same rows')
  assert.equal(drafting.asked.every((one) => one.kayan !== 'courses' || one.draft === true), true, 'every read of the courses is the draft read')
  assert.deepEqual(figures.fees, [['SAR', 125]], 'Total fees sums the courses not archived, one sum per currency, and leaves the archived dollar course out as its footer says')

  const plain = draftedCourses({ collections: { courses: { ...priced, operations: { find: true } } } })
  assert.equal((await dashboardLoader(plain)).courses, 2)
  assert.equal(plain.asked.every((one) => !one.draft), true, 'no draft read for a reader who may not read drafts')
})

// The portal as the courses example draws it, over a client answering from rows held here.
const portalScreen = asas.targets.portal.client
const soon = (days: number) => new Date(Date.now() + days * 864e5).toISOString()
const portalRows = (over: { settings?: Record<string, unknown> | null } = {}) => ({
  courses: [
    { id: 'c1', title: 'Calligraphy', summary: 'First strokes.', fee: 50, currency: 'USD', tags: ['t1'], selfEnroll: true },
    { id: 'c2', title: 'Python', summary: 'First programs.', fee: 0, currency: 'USD', tags: [], selfEnroll: true },
    { id: 'c3', title: 'Rhetoric', summary: 'Staff enroll.', fee: 10, currency: 'USD', tags: [] },
  ],
  sessions: [
    { id: 's1', course: 'c1', startsAt: soon(1), venue: 'campus', format: 'workshop', capacity: 10 },
    { id: 's2', course: 'c2', startsAt: soon(5) },
    { id: 's3', course: 'c3', startsAt: soon(6) },
  ],
  enrollments: [{ id: 'e1', session: 's1', student: 'u1' }, { id: 'e2', session: 's2', student: 'u9' }],
  tags: [{ id: 't1', name: { en: 'Arts', ar: 'فنون' } }],
  user: [{ id: 'u1', name: 'Sara' }],
  settings: over.settings === undefined ? { maintenance: false, contactEmail: 'office@school.test' } : over.settings,
})
const portalClient = (rows: ReturnType<typeof portalRows>, asked: { kayan: string; operation: string; input: Record<string, unknown> }[] = []) =>
  (async ({ kayan, operation, input }: { kayan: string; operation: string; input: Record<string, unknown> }) => {
    asked.push({ kayan, operation, input })
    if (kayan === 'settings') return rows.settings
    if (operation === 'findWithSessions') return { ...rows.courses.find((one) => one.id === input.id), sessions: rows.sessions.filter((one) => one.course === input.id || one.id === 's2').map((one) => ({ ...one, seatsLeft: one.id === 's2' ? 0 : 2 })) }
    if (operation !== 'find') return { id: 'new' }
    const where = input.where as { id?: { in?: string[] }; student?: { equals?: string } } | undefined
    const docs = ((rows as Record<string, unknown>)[kayan] as Record<string, unknown>[] | undefined ?? [])
      .filter((one) => !where?.id?.in || where.id.in.includes(String(one.id)))
      .filter((one) => !where?.student?.equals || one.student === where.student.equals)
    return { docs, totalDocs: docs.length }
  }) as ScreenState['client']
const student = { screens: ['portal'], collections: { enrollments: { operations: { find: true, create: true, delete: true } }, courses: { operations: { find: true } } } }
const instructor = { screens: ['portal'], collections: { enrollments: { operations: { find: true, create: true, others: true }, fields: { student: { read: true } } }, courses: { operations: { find: true } } } }
const sara = { id: 'u1', name: 'Sara', email: 'sara@example.com', organizations: [{ id: 'o1', name: 'Al-Noor School' }], activeOrganizationId: 'o1' }
const drawPortal = async (element: ReactElement, over: Partial<ScreenState>) => {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const host = await render(createElement(QueryClientProvider, { client: queries }, element), { screen: portalScreen, user: sara, kayan: undefined, ...over })
  // The page's reads settle one after another: the seats, then their sessions, courses and covers.
  for (let at = 0; at < 6; at++) await act(async () => sleep(5))
  return host
}

test('233n. the portal home is the organization\'s, in its own look: its name at the head, the student\'s next session, the courses it can join that it holds no seat in, and where to write at its foot', async () => {
  const { Home } = await import('../../../templates/asas/src/ui-portal/courses-home.tsx')
  const host = await drawPortal(createElement(Home), { access: student, client: portalClient(portalRows()), path: portalScreen.path })
  assert.equal(host.querySelector('header a')?.textContent?.includes('Al-Noor School'), true, 'the organization\'s name is the site\'s')
  assert.match(host.querySelector('h1')!.textContent!, /Sara/, 'the greeting names the viewer')
  const next = host.querySelector('section[aria-labelledby="next"]')
  assert.match(next?.textContent ?? '', /Calligraphy/, 'the next session is its own, of the course it holds a seat in')
  assert.match(next?.textContent ?? '', /Campus · Workshop/, 'with where and how it meets, in the viewer\'s words')
  const joinable = [...host.querySelectorAll('section[aria-labelledby="join"] a[href^="/portal/courses/"]')].map((one) => one.getAttribute('href'))
  assert.deepEqual(joinable, ['/portal/courses/c2'], 'and offers the course it holds no seat in and may enroll itself in, not one its school enrolls')
  assert.ok(host.querySelector('footer a[href="mailto:office@school.test"]'), 'the contact address is at the foot')
  assert.deepEqual([...host.querySelectorAll('nav')].map((one) => one.getAttribute('aria-label')), ['Portal', 'Portal'], 'one nav at the top from md up, one at the foot of a phone')
  assert.equal(host.querySelector('nav a[aria-current="page"]')?.getAttribute('href'), '/portal', 'Home is current on the home')
  assert.match(host.querySelector('nav')!.textContent!, /My enrollments/, 'and a student\'s seats are its own')
})

test('233p. while maintenance is on, a student meets the closed page with where to write, and an instructor keeps working', async () => {
  const { Home } = await import('../../../templates/asas/src/ui-portal/courses-home.tsx')
  const rows = portalRows({ settings: { maintenance: true, contactEmail: 'office@school.test' } })
  const closed = await drawPortal(createElement(Home), { access: student, client: portalClient(rows), path: portalScreen.path })
  assert.ok(closed.querySelector('[data-portal-closed]'), 'the student is shown the closed page')
  assert.equal(closed.querySelector('h1')?.textContent, 'Closed for maintenance', 'as the page\'s one heading')
  assert.ok(closed.querySelector('[data-portal-closed] a[href="mailto:office@school.test"]'), 'with the address to write to')
  const open = await drawPortal(createElement(Home), { access: instructor, client: portalClient(rows), path: portalScreen.path })
  assert.equal(open.querySelector('[data-portal-closed]'), null, 'an instructor works on')
  const unread = await drawPortal(createElement(Home), { access: student, client: portalClient(portalRows({ settings: null })), path: portalScreen.path })
  assert.equal(unread.querySelector('[data-portal-closed]'), null, 'and settings nobody wrote close nothing')
})

test('233q. the catalogue draws each course on offer as a card with its tag, next session and fee, searched by title and narrowed by tag', async () => {
  const { Catalogue } = await import('../../../templates/features/courses/portal/ui/catalogue.tsx')
  const asked: { kayan: string; operation: string; input: Record<string, unknown> }[] = []
  const host = await drawPortal(createElement(Catalogue), { access: student, client: portalClient(portalRows(), asked), kayan: portalScreen.kayan.courses })
  const cards = () => [...host.querySelectorAll('a[href^="/portal/courses/"]')].map((one) => one.textContent ?? '')
  assert.equal(cards().length, 3)
  assert.match(cards()[0]!, /Arts.*Calligraphy.*First strokes\..*Next session.*\$50\.00/, 'the tag, title, summary, next session and fee')
  assert.match(cards()[1]!, /Free/, 'a fee of nought reads as free')
  assert.deepEqual(asked.find((one) => one.kayan === 'courses')?.input.where, { or: [{ archived: { exists: false } }, { archived: { equals: false } }] }, 'only courses not archived are asked for')
  await act(async () => typeInto(host.querySelector('input[type="search"]')!, 'pyth'))
  assert.deepEqual(cards().map((one) => /Python/.test(one)), [true], 'the search keeps what it names')
  await act(async () => typeInto(host.querySelector('input[type="search"]')!, ''))
  const arts = [...host.querySelectorAll('[role="group"] button')].find((one) => one.textContent === 'Arts')!
  await act(async () => click(arts))
  assert.deepEqual(cards().map((one) => /Calligraphy/.test(one)), [true], 'and a tag keeps the courses it labels')
})

test('233r. a course that lets students enroll themselves offers the sessions with a seat left and takes one for the viewer alone; one that does not says the school enrolls them', async () => {
  const { Course } = await import('../../../templates/features/courses/portal/ui/course.tsx')
  const rows = portalRows()
  rows.enrollments = []
  const asked: { kayan: string; operation: string; input: Record<string, unknown> }[] = []
  const host = await drawPortal(createElement(Course), { access: student, client: portalClient(rows, asked), kayan: portalScreen.kayan.courses, record: rows.courses[0]! })
  const radios = [...host.querySelectorAll('input[type="radio"]')] as unknown as HTMLInputElement[]
  assert.deepEqual(radios.map((one) => [one.value, one.disabled]), [['s1', false], ['s2', true]], 'a full session is offered and cannot be picked')
  assert.match(host.textContent ?? '', /2 seats left/)
  assert.match(host.textContent ?? '', /Full/)
  const button = () => [...host.querySelectorAll('button')].find((one) => /Enroll on|Pick a session/.test(one.textContent ?? ''))!
  assert.equal(button().hasAttribute('disabled'), true, 'nothing is taken before a session is picked')
  await act(async () => click(radios[0] as unknown as Element))
  await act(async () => click(button()))
  await act(async () => sleep(5))
  assert.deepEqual(asked.find((one) => one.operation === 'create'), { kayan: 'enrollments', operation: 'create', input: { session: 's1' } }, 'the seat names its session alone, so the server makes it the viewer\'s')
  const off = { ...rows.courses[0]!, selfEnroll: false }
  rows.courses[0] = off
  const closed = await drawPortal(createElement(Course), { access: student, client: portalClient(rows), kayan: portalScreen.kayan.courses, record: off })
  assert.equal(closed.querySelectorAll('input[type="radio"]').length, 0, 'a course the school enrolls offers no seat')
  assert.match(closed.textContent ?? '', /Ask your school to enroll you\./)
})

test('233t. an instructor\'s new enrollment on the portal draws the student it enrolls beside the session', async () => {
  const { PortalShell } = await import('../../../templates/features/courses/portal/ui/shell.tsx')
  const { Page } = await import('../../../templates/asas/src/ui-portal/page.tsx')
  const kayan = portalScreen.kayan.enrollments!
  const page = kayan.pages.create! as Extract<PageClient, { page: unknown }>
  const refs = { [portalScreen.layouts.top!]: PortalShell, [portalScreen.layouts.page!]: Page } as never
  const form = createElement(Form, { kayan, screen: { refs, kayan, page }, client: publishedClient([], []), value: null, t, locale: 'en', onDone: () => {}, onCancel: () => {} })
  const host = await drawPortal(form, { access: instructor, client: portalClient(portalRows()), kayan })
  assert.ok(host.querySelector('#enrollments-session'), 'the session')
  assert.ok(host.querySelector('#enrollments-student'), 'and the student, whom an instructor picks')
})

test('233s. a student reads its own seats as cards, upcoming first, each giving its seat back; an instructor reads every seat as a table with the student, named only where it may read them', async () => {
  const { Enrollments } = await import('../../../templates/features/courses/portal/ui/enrollments.tsx')
  const rows = portalRows()
  const mine = await drawPortal(createElement(Enrollments), { access: student, client: portalClient(rows), kayan: portalScreen.kayan.enrollments })
  const cards = [...mine.querySelectorAll('main li')].map((one) => one.textContent ?? '')
  assert.match(cards[0]!, /^Calligraphy.*Campus · Workshop.*Starts tomorrow.*Cancel enrollment/, 'the soonest first, with its course, place, how soon, and its cancel')
  assert.match(cards[1]!, /^Python/)
  assert.equal(mine.querySelector('table'), null, 'no table for a student')
  const every = await drawPortal(createElement(Enrollments), { access: instructor, client: portalClient(rows), kayan: portalScreen.kayan.enrollments })
  const heads = [...every.querySelectorAll('th')].map((one) => one.textContent)
  assert.deepEqual(heads, ['Course', 'Session', 'Venue and format', 'Student'])
  const students = [...every.querySelectorAll('tbody tr')].map((one) => one.lastElementChild?.textContent)
  assert.deepEqual(students, ['Sara', 'Not available'], 'a student the server lets it read by name, and one it does not left unnamed')
  assert.ok(every.querySelector('a[href="/portal/enrollments/new"]'), 'and the instructor enrolls a student from here')
})

test('233o. a range of days takes the form its language gives that count, so Arabic says "7 أيام" and "30 يومًا", and the viewing label reads naturally', async () => {
  const { translator } = await import('../../../apps/asas-tanstack/src/copy.ts')
  const { counted } = await import('../registry/format.tsx')
  const days = (locale: 'en' | 'ar', key: string, count: number) => counted({ t: translator(locale), locale, key, count, fallback: '' }).replace(/[\u200e\u200f]/g, '')
  assert.equal(days('en', 'dashboard.chartDays', 7), '7 days')
  assert.equal(days('en', 'dashboard.kpiInRange', 30), 'In the last 30 days')
  assert.equal(days('ar', 'dashboard.chartDays', 7), '7 أيام', 'three to ten: the plural')
  assert.equal(days('ar', 'dashboard.chartDays', 30), '30 يومًا', 'eleven to ninety-nine: the singular accusative')
  assert.equal(days('ar', 'dashboard.chartDays', 90), '90 يومًا')
  assert.equal(days('ar', 'dashboard.kpiInRange', 7), 'خلال آخر 7 أيام')
  assert.equal(days('ar', 'dashboard.kpiInRange', 30), 'خلال آخر 30 يومًا')
  assert.equal(translator('ar')('version.currentlyViewing'), 'الإصدار المعروض')
})

test('223a. on a kayan that keeps drafts and whose update takes expectedUpdatedAt, each autosave and draft save sends the instant the last write answered with, and a stale refusal stops the autosave and says why', async () => {
  const calls: DraftCall[] = []
  let answered = 0
  let answer = async (call: DraftCall): Promise<unknown> => ({ ...call.input, _status: 'draft', updatedAt: `2026-10-09T10:00:0${++answered}.000Z` })
  await toasted()
  const host = await render(withToaster(createElement(Form, {
    kayan: courses,
    client: draftClient(calls, (call) => answer(call)),
    value: { ...draftRow, updatedAt: '2026-10-09T09:00:00.000Z' },
    t,
    locale: 'en',
    onDone: () => {},
    drafts: { status: 'published', autosave: 100 },
    expectedUpdatedAt: true,
  })))
  const title = () => host.querySelector('#courses-title')!
  const type = async (words: string) => {
    await act(async () => {
      typeInto(title(), words)
    })
    await act(async () => sleep(300))
  }
  await type('Tajweed I')
  await type('Tajweed II')
  await act(async () => {
    typeInto(title(), 'Tajweed III')
  })
  await act(async () => {
    click(buttonNamed(host, 'Save draft')!)
  })
  assert.deepEqual(
    calls.map((one) => [one.input.expectedUpdatedAt, one.options]),
    [
      ['2026-10-09T09:00:00.000Z', { draft: true, autosave: true }],
      ['2026-10-09T10:00:01.000Z', { draft: true, autosave: true }],
      ['2026-10-09T10:00:02.000Z', { draft: true }],
    ],
    'the read instant, then each one the write before answered with',
  )
  answer = async () => {
    throw Object.assign(new Error('Conflict'), { status: 409, data: { key: 'error.conflict.stale', params: { kayan: 'courses' } } })
  }
  await type('Tajweed IV')
  assert.equal(calls.length, 4, 'the stale autosave was asked once')
  assert.ok(host.querySelector('[data-stale-notice] [data-button="reload"]'), 'and the person is told why, on the form, for as long as it holds, beside a reload')
  await type('Tajweed V')
  await type('Tajweed VI')
  assert.equal(calls.length, 4, 'and nothing autosaves after it, whatever is typed')
})

test('223b. Discard on a create page sends the delete the instant this page\'s last autosave answered with, where the kayan\'s delete takes it', async () => {
  for (const takes of [true, false]) {
    const deletes: Record<string, unknown>[] = []
    let answered = 0
    const client = {
      ...leavingClient([]),
      create: async (input: Record<string, unknown>) => ({ ...input, id: 'made-1', _status: 'draft', updatedAt: `2026-10-09T10:00:0${++answered}.000Z` }),
      update: async (input: Record<string, unknown>) => ({ ...input, _status: 'draft', updatedAt: `2026-10-09T10:00:0${++answered}.000Z` }),
      delete: async (input: Record<string, unknown>) => (deletes.push(input), input),
    }
    const left: string[] = []
    const host = await render(createElement(function Host(): ReactElement {
      const [row, setRow] = useState<Record<string, unknown> | null>(null)
      return createElement(Form, {
        kayan: courses,
        client: client as never,
        value: row,
        t,
        locale: 'en',
        onDone: (made: unknown, effect?: string) => effect === 'create' && setRow(made as Record<string, unknown>),
        onCancel: () => left.push('cancel'),
        operations: { delete: true },
        drafts: { status: 'draft' as const, autosave: 50 },
        expectedUpdatedAt: true,
        expectedUpdatedAtOn: takes ? ['delete'] : [],
      })
    }))
    for (const words of ['Taj', 'Tajweed']) {
      await act(async () => {
        typeInto(host.querySelector('#courses-title')!, words)
      })
      await act(async () => sleep(150))
    }
    await act(async () => {
      typeInto(host.querySelector('#courses-title')!, 'Tajweed II')
    })
    await act(async () => {
      click(cancelOf(host)!)
    })
    await act(async () => {
      click(dialogButton('Discard changes')!)
    })
    await act(async () => sleep(0))
    assert.deepEqual(deletes, [takes ? { id: 'made-1', expectedUpdatedAt: '2026-10-09T10:00:02.000Z' } : { id: 'made-1' }], takes ? 'the instant of the last autosave rides on the delete' : 'and nothing a delete would refuse is sent where it takes none')
    assert.deepEqual(left, ['cancel'])
    await act(async () => mounted?.unmount())
    mounted = undefined
  }
})

test('223e. Discard changes on a changed row sends the instant the form holds, where the kayan\'s restoreVersion takes it', async () => {
  for (const takes of [true, false]) {
    const asked: Asked[] = []
    const value = { ...draftRow, updatedAt: '2026-10-09T09:00:00.000Z' }
    const host = await render(createElement(Form, { kayan: courses, screen: screenOf(courses.pages.edit!), client: publishedClient([], asked), value, t, locale: 'en', onDone: () => {}, operations: { restoreVersion: true }, drafts: { status: 'changed' }, expectedUpdatedAt: true, expectedUpdatedAtOn: takes ? ['restoreVersion'] : [] }), { record: value })
    await act(async () => {
      click(buttonNamed(host, 'Discard changes')!)
    })
    await act(async () => {
      click(window.document.querySelector('[data-slot="alert-dialog-content"] [data-button="confirm-discard-draft"]') as unknown as Element)
    })
    assert.deepEqual(asked, [{ operation: 'restoreVersion', input: takes ? { id: 'a-row', expectedUpdatedAt: '2026-10-09T09:00:00.000Z' } : { id: 'a-row' } }], takes ? 'the restore carries the instant' : 'and none where the restore takes none')
    await act(async () => mounted?.unmount())
    mounted = undefined
  }
})

test('223f. a restore from the Versions tab sends the instant of the latest version it read, where the form says the kayan\'s restoreVersion takes it', async () => {
  await toasted()
  const { Versions } = await import('../../../templates/asas/src/ui-dashboard/versions.tsx')
  const reload = window.location.reload
  Object.defineProperty(window.location, 'reload', { configurable: true, value: () => {} })
  const rows = history.map((one) => (one.latest ? { ...one, version: { ...one.version, updatedAt: '2031-01-05T09:59:59.000Z' } } : one))
  try {
    for (const takes of [true, false]) {
      const asked: Asked[] = []
      const form = { getData: () => ({}), setValue: () => {}, disabled: false, saves: 0, expectedUpdatedAtOn: takes ? ['restoreVersion'] : [] }
      const host = await render(createElement(FormContext, { value: form }, createElement(Versions, { page: undefined as never })), { client: historyClient(asked, async () => ({}), rows), record: versionRecord, access: restoring, kayan: versioned })
      await act(async () => sleep(0))
      await openVersion(host, 'v1')
      await act(async () => {
        click(sheet()!.querySelector('[data-button="restore"]')!)
      })
      await act(async () => {
        click(window.document.querySelector('[data-slot="alert-dialog-content"] [data-button="confirm-restore"]') as unknown as Element)
      })
      await act(async () => sleep(0))
      assert.deepEqual(asked.at(-1), { operation: 'restoreVersion', input: takes ? { id: 'v1', expectedUpdatedAt: '2031-01-05T09:59:59.000Z' } : { id: 'v1' }, options: { draft: false } }, takes ? 'the latest version\'s instant rides on the restore' : 'and none where the restore takes none')
      // The restore reloads the page, so its toast is carried to the page it reloads into.
      const toaster = await render(withToaster(createElement('p')))
      assert.equal(toaster.querySelectorAll('[data-toast="success"]').length, 1, 'whose toast says the restore landed')
      await toasted()
      await act(async () => mounted?.unmount())
      mounted = undefined
    }
  } finally {
    Object.defineProperty(window.location, 'reload', { configurable: true, value: reload })
  }
})

test('240a. a save, a create, a publish, a draft save, a delete and a kayan\'s own operation each say in a green toast that they landed, in the kayan\'s words', async () => {
  await toasted()
  const calls: DraftCall[] = []
  const draw = (props: Record<string, unknown>) => render(withToaster(createElement(Form, { kayan: courses, client: draftClient(calls, async (call) => ({ id: 'a-row', ...call.input })), t: english, locale: 'en', onDone: () => {}, value: draftRow, ...props })))
  let host = await draw({})
  await act(async () => typeInto(host.querySelector('#courses-title')!, 'Tajweed II'))
  await act(async () => fire(host.querySelector('form')!, 'submit'))
  assert.deepEqual(await toasted(), ['success: Course saved'], 'a plain save')
  host = await draw({ value: null })
  await act(async () => typeInto(host.querySelector('#courses-title')!, 'Tajweed'))
  await act(async () => fire(host.querySelector('form')!, 'submit'))
  assert.deepEqual(await toasted(), ['success: Course created'], 'a create')
  host = await draw({ drafts: { status: 'draft' } })
  await act(async () => typeInto(host.querySelector('#courses-title')!, 'Tajweed III'))
  await act(async () => click(host.querySelector('[data-button="save-draft"]')!))
  assert.deepEqual(await toasted(), ['success: Draft saved'], 'a draft save')
  await act(async () => click(host.querySelector('[data-button="publish"]')!))
  assert.deepEqual(await toasted(), ['success: Course published'], 'a publish')

  const ran: string[] = []
  const operations = { delete: true, archive: true }
  host = await render(withToaster(createElement(Form, {
    kayan: courses,
    screen: screenOf(courses.pages.edit!),
    client: { ...draftClient([]), delete: async () => ({}), run: async (operation: string) => (ran.push(operation), { id: 'a-row' }) },
    value: draftRow,
    t: english,
    locale: 'en',
    onDone: () => {},
    operations,
  })), { record: draftRow })
  await act(async () => click(host.querySelector('[aria-label="More actions"]')!))
  await act(async () => click([...window.document.querySelectorAll('button')].find((button) => button.textContent === 'Archive')! as unknown as Element))
  await act(async () => typeInto(window.document.querySelector('[data-slot="alert-dialog-content"] form :is(textarea, input)') as unknown as Element, 'Retired'))
  await act(async () => fire(window.document.querySelector('[data-slot="alert-dialog-content"] form') as unknown as Element, 'submit'))
  assert.deepEqual(ran, ['archive'])
  assert.deepEqual(await toasted(), ['success: Course archived'], 'a kayan\'s own operation, in its own words')
  await act(async () => click(window.document.querySelector('[data-button="delete"]') as unknown as Element))
  await act(async () => click(dialogButton('Delete this course')!))
  assert.deepEqual(await toasted(), ['success: Course deleted'], 'a delete')
})

test('240b. a save the server refuses over no field, or that never reaches it, says why in a red toast and draws nothing in the page header', async () => {
  await toasted()
  const refusal = Object.assign(new Error('Forbidden'), { status: 403, data: { key: 'error.forbidden.update', params: {} } })
  let thrown: unknown = refusal
  const client = draftClient([], async () => {
    throw thrown
  })
  const host = await render(withToaster(createElement(Form, { kayan: courses, screen: screenOf(courses.pages.edit!), client, value: draftRow, t: english, locale: 'en', onDone: () => {}, drafts: { status: 'draft' } })), { record: draftRow })
  await act(async () => click(host.querySelector('[data-node="controls"] [data-button="publish"]')!))
  assert.deepEqual(await toasted(), [`error: ${english('error.forbidden.update')}`], 'the refusal\'s own sentence, in red')
  assert.equal(host.querySelectorAll('[role="alert"]').length, 0, 'and no alert on the page, in the header or the form')
  thrown = new TypeError('Failed to fetch')
  await act(async () => click(host.querySelector('[data-node="controls"] [data-button="publish"]')!))
  assert.deepEqual(await toasted(), ['error: Something went wrong, so nothing was saved. Try again.'], 'a request that never answered says so, where it said nothing before')
})

test('240d. a save refused over fields lists each in a summary at the top of the form, which takes the focus from any tab, and each line is a link that opens its tab and focuses its box', async () => {
  await toasted()
  const refusal = Object.assign(new Error('Bad Request'), { status: 400, data: { key: 'error.invalid.value', params: { issues: [{ path: 'title', message: 'A published course needs a title.' }] } } })
  const host = await render(withToaster(createElement(Form, { kayan: courses, screen: screenOf(courses.pages.edit!), client: draftClient([], async () => {
    throw refusal
  }), value: draftRow, t: english, locale: 'en', onDone: () => {}, drafts: { status: 'draft' } })), { record: draftRow })
  const tab = (words: string) => [...host.querySelectorAll('[data-slot="tabs-trigger"]')].find((one) => one.textContent?.includes(words))!
  await act(async () => click(tab('Sessions')))
  await act(async () => click(host.querySelector('[data-node="controls"] [data-button="publish"]')!))
  await act(async () => sleep(10))
  assert.equal(host.querySelectorAll('[data-region="header"] [role="alert"]').length, 0, 'the header says nothing of it')
  assert.deepEqual(await toasted(), [], 'nor does a toast, since the fields are named where they are')
  const summary = host.querySelector('form [data-error-summary]') as HTMLElement | null
  assert.ok(summary, 'a summary is drawn inside the form')
  assert.deepEqual([...summary!.querySelectorAll('a')].map((one) => [one.textContent, one.getAttribute('href')]), [['Title: A published course needs a title.', '#courses-title']], 'one line per field, its label and its sentence, a link to its box')
  assert.equal(window.document.activeElement === (summary as unknown), true, 'and the focus moves to it')
  assert.equal(tab('Details').getAttribute('aria-selected'), 'true', 'which opened the tab it sits on')
  await act(async () => click(tab('Sessions')))
  await act(async () => click(summary!.querySelector('a')!))
  await act(async () => sleep(10))
  assert.equal(window.document.activeElement?.id, 'courses-title', 'a line focuses its box, opening its tab first')
  assert.ok(host.querySelector('#courses-title')!.closest('[data-slot="field"]')?.textContent?.includes('A published course needs a title.'), 'and the sentence stays under the box')
})

test('240e. a section and an accordion holding a refused field each show a red count, as a tab does', async () => {
  const refusal = { data: { key: 'error.invalid.value', params: { issues: [{ path: 'title', message: 'A course needs a title.' }, { path: 'summary', message: 'Too long.' }] } } }
  const fields = [{ field: 'title' }, { field: 'summary' }]
  for (const group of [{ section: 'about', fields }, { accordion: [{ item: 'about', fields }] }]) {
    const host = await render(createElement(Form, { kayan: courses, screen: screenOf(recordPage([{ form: [group] }])), client: recording().client, value: draftRow, error: refusal, t: english, locale: 'en', onDone: () => {} }))
    const pill = host.querySelector(`[data-node="${'section' in group ? 'section' : 'accordion'}"] [data-mithaq-invalid]`)
    assert.equal(pill?.getAttribute('data-mithaq-invalid'), '2', `the ${'section' in group ? 'section' : 'accordion item'} counts its two refused fields`)
    assert.equal(pill?.getAttribute('aria-label'), 'Fields needing attention: 2')
  }
})

test('240f. a box is told it is wrong only once the person leaves its field: never while the focus moves inside it, or into a popup it opened', async () => {
  const host = await render(createElement(Form, {
    kayan: sessions, screen: screenOf(recordPage([{ form: [{ field: 'startsAt' }, { field: 'capacity' }] }], '/sessions/new'), sessions), client: recording().client, value: null, t: english, locale: 'en', onDone: () => {},
  }))
  const day = host.querySelector('button#sessions-startsAt')!
  const leave = (to: Element | null) => day.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true, relatedTarget: to as never }) as unknown as Event)
  const inside = day.closest('[data-slot="field"]')!.querySelector(':is(input, button):not(#sessions-startsAt)')
  assert.ok(inside, 'the moment has a second box in its field, the time')
  await act(async () => void leave(inside))
  assert.equal(host.querySelector('#sessions-startsAt-error'), null, 'from the day to the time is no leaving')
  const popup = window.document.createElement('div')
  popup.setAttribute('data-slot', 'popover-content')
  const pick = window.document.createElement('button')
  popup.append(pick)
  window.document.body.append(popup)
  await act(async () => void leave(pick as unknown as Element))
  assert.equal(host.querySelector('#sessions-startsAt-error'), null, 'nor into the calendar it opened')
  popup.remove()
  await act(async () => void leave(host.querySelector('#sessions-capacity')))
  assert.equal(host.querySelector('#sessions-startsAt-error')?.textContent, 'This field is required.', 'leaving for another field marks it')
})

/** The full-page drawer a create opens in, which a portal draws on the body. */
const documentDrawer = () => window.document.querySelector('[data-document-drawer]') as unknown as Element | null

test('240g. a child made from its parent\'s tab opens in a full-page drawer over the page, as Payload\'s document drawer does, which closes once the write lands and says so in a toast', async () => {
  await toasted()
  const writes: { write: string; input: Record<string, unknown> }[] = []
  const docs = [{ id: 's1', course: 'c1', startsAt: '2026-10-01T10:00:00.000Z', capacity: 5, venue: 'campus', format: 'lecture', archived: false }]
  const host = await render(withToaster(createElement(Form, {
    kayan: courses,
    screen: screenOf(courses.pages.edit!),
    client: draftClient([]),
    value: { id: 'c1', title: 'Tajweed' },
    t: english,
    locale: 'en',
    onDone: () => {},
    related: ({ node }) => createElement(List, {
      key: 'sessions', kayan: sessions, node, page: pageOf(docs), query: {}, t: english, locale: 'en', onQuery: () => {},
      href: (id: string) => `/sessions/${id}`, newHref: '#', screen: screenOf(courses.pages.edit!), creates: true, operations: { update: true }, writes: () => true,
      edit: {
        client: {
          create: async (input: Record<string, unknown>) => (writes.push({ write: 'create', input }), { id: 'made', ...input }),
          update: async (input: Record<string, unknown>) => (writes.push({ write: 'update', input }), input),
          delete: async () => ({}),
        },
        writes: () => true,
        prefill: { course: 'c1' },
      },
    }),
  })), { record: { id: 'c1', title: 'Tajweed' } })
  await act(async () => click([...host.querySelectorAll('[data-slot="tabs-trigger"]')].find((one) => one.textContent?.includes('Sessions'))!))
  await act(async () => click([...host.querySelectorAll('button')].find((one) => one.textContent?.trim() === 'New session' || one.textContent?.trim() === 'New')!))
  const drawer = documentDrawer()
  assert.ok(drawer, 'New opens a drawer')
  assert.equal(host.querySelector('[data-mithaq-inline-edit]'), null, 'and no form under the list')
  assert.equal(drawer!.getAttribute('data-slot'), 'sheet-content', 'a modal the page stays under, which Esc and its close button leave')
  assert.ok(classesOf(drawer).some((one) => one.includes('w-[calc(100%-')), 'as wide as the page but a strip of it, as Payload\'s')
  assert.equal(drawer!.querySelector('h2')?.textContent, 'New session', 'its title says what it makes')
  assert.ok(drawer!.querySelector('[data-slot="sheet-close"]'), 'and it has a close button')
  await act(async () => click(drawer!.querySelector('button#sessions-startsAt')!))
  await act(async () => click(window.document.querySelector('[data-today] button') as unknown as Element))
  await typeTime(drawer!, '09:30')
  await act(async () => fire(drawer!.querySelector('form')!, 'submit'))
  assert.deepEqual(writes.map((one) => [one.write, one.input.course]), [['create', 'c1']], 'the drawer\'s save is the session\'s own create, holding this course')
  assert.equal(documentDrawer(), null, 'and the drawer closes once it lands')
  assert.deepEqual(await toasted(), ['success: Session created'], 'with a toast that says so')
})

test('240h. a relationship picker offers a + beside it, for a viewer who may create its kayan, that makes the row in a drawer and picks it', async () => {
  await toasted()
  const made: Record<string, unknown>[] = []
  const client = async ({ kayan, operation, input }: { kayan: string; operation: string; input: Record<string, unknown> }) => {
    made.push({ kayan, operation, input })
    return { id: 'tag-new', ...input }
  }
  const tags = screen.kayan.tags!
  const access = { collections: { tags: { create: true, read: true, operations: { create: true }, fields: { name: { create: true, read: true } } } } }
  const draw = (over: Partial<ScreenState>) => render(withToaster(createElement(Form, {
    kayan: courses, screen: screenOf(recordPage([{ form: ['title', 'tags'] }])), client: recording().client, value: draftRow, t: english, locale: 'en', onDone: () => {},
    kayans, api: fakeApi({ tags: [] }).api,
  })), { client: client as never, access: access as never, ...over })
  let host = await draw({})
  const plus = () => host.querySelector('[data-control="relationship"] button[data-add-new]') as HTMLButtonElement | null
  assert.equal(plus()?.getAttribute('aria-label'), 'Add new Tag', 'the + is named for what it makes')
  await act(async () => click(plus()!))
  const drawer = documentDrawer()
  assert.ok(drawer, 'and opens a drawer')
  assert.equal(drawer!.querySelector('h2')?.textContent, 'New tag')
  assert.equal(drawer!.querySelectorAll('h1').length, 0, 'which is its one title: the form draws no heading of its own under it')
  await act(async () => typeInto(drawer!.querySelector('#tags-name')!, 'Beginner'))
  await act(async () => fire(drawer!.querySelector('form')!, 'submit'))
  await act(async () => sleep(0))
  assert.deepEqual(made.map((one) => [one.kayan, one.operation]), [['tags', 'create']], 'the row is made through the screen\'s client')
  assert.equal(documentDrawer(), null, 'the drawer closes')
  assert.ok(host.querySelector('[data-control="relationship"]')?.textContent?.includes('Beginner'), 'and the new row is picked')
  assert.deepEqual(await toasted(), ['success: Tag created'])
  host = await draw({ access: { collections: { tags: { read: true } } } as never })
  assert.equal(plus(), null, 'a viewer who may not create a tag gets no +')
})

test('240i. a record never published is published with Publish, one already published with Publish changes, and beside a draft that saves itself Cancel says it goes back to the list', async () => {
  const named = async (drafts: Record<string, unknown>, value: Record<string, unknown> | null = draftRow) => {
    const host = await render(createElement(Form, { kayan: courses, client: draftClient([]), value, t: english, locale: 'en', onDone: () => {}, onCancel: () => {}, drafts }))
    return [publishOf(host)?.textContent?.trim(), cancelOf(host)?.textContent?.trim()]
  }
  assert.deepEqual(await named({ status: 'draft' }), ['Publish', 'Cancel'], 'a draft never published')
  assert.deepEqual(await named({}, null), ['Publish', 'Cancel'], 'and a record being made')
  assert.deepEqual(await named({ status: 'published' }), ['Publish changes', 'Cancel'], 'a published record')
  assert.deepEqual(await named({ status: 'changed' }), ['Publish changes', 'Cancel'], 'and one with a draft pending')
  assert.deepEqual(await named({ status: 'draft', autosave: 2000 }), ['Publish', 'Back to list'], 'a draft that saves itself has nothing to cancel, so the button says where it goes')
})

test('audit F09: Publish on a new course sends no draft status', async () => {
  const calls: DraftCall[] = []
  const host = await render(createElement(Form, { kayan: courses, client: draftClient(calls), value: null, t: english, locale: 'en', onDone: () => {}, drafts: {} }))
  await act(async () => typeInto(host.querySelector('#courses-title')!, 'New course'))
  assert.equal(publishOf(host)?.textContent?.trim(), 'Publish')
  await act(async () => click(publishOf(host)!))
  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.operation, 'create')
  assert.equal('_status' in calls[0]!.input, false)
  assert.equal(calls[0]!.options?.draft, undefined)
})

test('240k. a yes-or-no field on a record page reads its own word for yes or no under its label, an unset one its no, never a dash', async () => {
  const { FieldValue } = await import('../registry/field-value.tsx')
  const archived = courses.fields.find((one) => one.name === 'archived')!
  const words = async (value: unknown) => (await render(createElement(FieldValue, { kayan: courses, field: archived, row: { id: 'c1', archived: value }, copy: { t: english, locale: 'en' } }))).querySelector('[data-field-value="archived"]')?.textContent
  assert.equal(await words(true), 'ArchivedArchived', 'set, in the field\'s own word')
  assert.equal(await words(false), 'ArchivedActive', 'cleared')
  assert.equal(await words(null), 'ArchivedActive', 'and a row from before the column, which holds nothing, reads the same as cleared')
  const verified = fieldOf({ name: 'probe', kind: 'checkbox' })
  assert.equal((await render(createElement(FieldValue, { kayan: courses, field: verified, row: { id: 'c1', probe: true }, copy: { t: english, locale: 'en' } }))).querySelector('[data-field-value="probe"]')?.textContent, 'probeYes', 'and a field with no words of its own reads Yes or No')
})

test('240l. a moment\'s time of day is two shadcn boxes and an AM or PM, the same in every browser: digits fill hours then minutes, arrows step them, the moment is written once day and time are set and cleared with a complete time, and Arabic draws Latin digits and its own period words', async () => {
  const { client, written } = recording()
  const page = (path: string) => screenOf(recordPage([{ form: [{ field: 'startsAt' }, { field: 'capacity' }] }], path), sessions)
  const host = await render(createElement(Form, { kayan: sessions, screen: page('/sessions/new'), client, value: null, t: english, locale: 'en', onDone: () => {} }))
  assert.equal(host.querySelector('input[type="time"]') === null, true, 'no native time box, which Safari hands back empty')
  const segment = (name: string) => host.querySelector(`[data-time-field] [data-segment="${name}"]`) as HTMLInputElement
  assert.deepEqual(['hours', 'minutes'].map((name) => segment(name)?.getAttribute('data-slot')), ['input', 'input'], 'each segment is a shadcn box of its own, as openstatus\'s')
  assert.equal(segment('hours').disabled, true, 'and takes nothing until a day is picked')
  await act(async () => click(host.querySelector('button#sessions-startsAt') as unknown as Element))
  await act(async () => click(window.document.querySelector('[data-today] button') as unknown as Element))
  await act(async () => press(segment('hours') as unknown as Element, '9'))
  assert.equal(segment('hours').value, '09', 'a digit no second can follow is the whole hour')
  assert.equal(window.document.activeElement === (segment('minutes') as unknown), true, 'and the minutes are next, as a native time box goes on')
  await act(async () => fire(host.querySelector('form')!, 'submit'))
  assert.equal(written.length, 0, 'half a time writes no moment')
  assert.equal(host.querySelector('#sessions-startsAt-error')?.textContent, 'This field is required.', 'and a required one says so')
  await act(async () => typeInto(segment('minutes') as unknown as Element, '30'))
  await act(async () => press(segment('minutes') as unknown as Element, 'ArrowUp'))
  assert.equal(segment('minutes').value, '31', 'an arrow steps the minutes')
  await act(async () => click(segment('period') as unknown as Element))
  assert.equal(segment('period').textContent, 'PM', 'and the button turns the morning to the evening')
  await act(async () => fire(host.querySelector('form')!, 'submit'))
  assert.equal(new Date(written[0]!.startsAt as string).toISOString(), new Date(`${today}T21:31`).toISOString(), 'the moment is the day at that time, on the 24-hour clock')
  await act(async () => press(segment('minutes') as unknown as Element, 'Backspace'))
  await act(async () => fire(host.querySelector('form')!, 'submit'))
  assert.equal(written.length, 1, 'clearing a complete time clears the moment, which a required start refuses')
  await act(async () => typeInto(segment('hours') as unknown as Element, '1045'))
  assert.deepEqual([segment('hours').value, segment('minutes').value], ['10', '45'], 'a whole time pasted into the hours fills both')

  const arabic = await render(createElement(Form, { kayan: sessions, screen: page('/sessions/:id'), client, value: { id: 's1', course: 'c1', startsAt: new Date(2026, 9, 15, 13, 5).toISOString() }, t: appCopy('ar'), locale: 'ar', onDone: () => {} }))
  const arabicSegment = (name: string) => arabic.querySelector(`[data-time-field] [data-segment="${name}"]`) as HTMLInputElement
  assert.deepEqual([arabicSegment('hours').value, arabicSegment('minutes').value, arabicSegment('period').textContent], ['01', '05', 'م'], 'Latin digits and its own word for the evening')
  assert.equal(arabicSegment('hours').closest('[dir]')?.getAttribute('dir'), 'ltr', 'the clock reads hours then minutes, as a clock does, on a page right to left')
  await act(async () => typeInto(arabicSegment('hours') as unknown as Element, '٠٢'))
  assert.equal(arabic.querySelector('[data-time-field]')?.getAttribute('data-value'), '14:05', 'and Arabic digits typed are read')
})

test('240m. a hovered list row tints every cell itself, the pinned title and actions included, so the row highlights as one in either theme', async () => {
  const host = await render(createElement(List, {
    kayan: courses, page: pageOf([{ id: 'c1', title: 'Tajweed', fee: 300 }]), query: {}, t, locale: 'en', onQuery: () => {},
    href: (id: string) => `/courses/${id}`, newHref: '/courses/new', operations: { delete: true }, run: async () => ({}),
  }))
  const cells = [...host.querySelectorAll('tbody tr[data-row="c1"] > td')]
  const tint = (cell: Element) => classesOf(cell).filter((one) => one.startsWith('group-hover/row:bg-'))
  assert.ok(cells.length > 2 && cells.some((cell) => classesOf(cell).includes('sticky')), 'the row has pinned cells and others')
  assert.deepEqual(cells.map(tint), cells.map(() => ['group-hover/row:bg-[color-mix(in_oklab,var(--muted)_50%,var(--card))]']), 'each cell paints the same opaque tint, so nothing but the cells decides the row\'s colour')
})

test('240n. a picker for an upload offers no + of its own, which its Upload new already is', async () => {
  const access = { collections: { media: { create: true, operations: { create: true }, fields: { alt: { create: true }, file: { create: true } } }, tags: { create: true, operations: { create: true }, fields: { name: { create: true } } } } }
  const host = await render(createElement(Form, {
    kayan: courses, screen: screenOf(recordPage([{ form: ['cover', 'tags'] }])), client: recording().client, value: draftRow, t: english, locale: 'en', onDone: () => {},
    kayans, api: fakeApi({ tags: [], media: [] }).api,
  }), { client: (async () => ({})) as never, access: access as never })
  assert.ok(host.querySelector('[data-control="relationship"] button[data-add-new]'), 'a relationship has it')
  assert.ok(host.querySelector('[data-control="upload"]'), 'the cover is drawn by its upload control')
  assert.equal(host.querySelector('[data-control="upload"] button[data-add-new]') === null, true, 'which draws no + beside its picker')
})

test('240o. an autosave refused over a field marks it and lists it quietly, and never takes the focus from the box being typed in', async () => {
  await toasted()
  const refusal = Object.assign(new Error('Bad Request'), { status: 400, data: { key: 'error.invalid.value', params: { issues: [{ path: 'summary', message: 'Too long.' }] } } })
  const host = await render(withToaster(createElement(Form, { kayan: courses, client: draftClient([], async () => {
    throw refusal
  }), value: draftRow, t: english, locale: 'en', onDone: () => {}, drafts: { status: 'published', autosave: 50 } })))
  const title = host.querySelector('#courses-title') as unknown as HTMLInputElement
  title.focus()
  await act(async () => typeInto(title as unknown as Element, 'Tajweed II'))
  await act(async () => sleep(200))
  await act(async () => sleep(50))
  assert.ok(host.querySelector('[data-error-summary]')?.textContent?.includes('Too long.'), 'the refused field is listed')
  assert.equal(window.document.activeElement === (title as unknown), true, 'and the focus stays in the box being typed in')
})

test('240p. a refusal the host hands the form that names no field is said in a red toast', async () => {
  await toasted()
  await render(withToaster(createElement(Form, { kayan: courses, client: draftClient([]), value: draftRow, t: english, locale: 'en', onDone: () => {}, error: { status: 403, data: { key: 'error.forbidden.update' } } })))
  assert.deepEqual(await toasted(), [`error: ${english('error.forbidden.update')}`])
})

test('240q. a red toast stays until it is closed, with its own close button, a green one leaves on its own, and a stale row is a lasting notice on the form with a reload, not a toast', async (t) => {
  await toasted()
  t.mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const host = await render(withToaster(createElement('p', null, 'page')))
    await act(async () => {
      toast.success('Saved')
      toast.error('Refused')
    })
    await act(async () => t.mock.timers.tick(60_000))
    assert.deepEqual([...host.querySelectorAll('[data-toast]')].map((one) => one.getAttribute('data-toast')), ['error'], 'a minute on, the failure is still there and the success is gone')
    assert.equal(host.querySelectorAll('[aria-live]').length, 1, 'in one live region')
    await act(async () => click(host.querySelector('[data-toast] [data-toast-close]')!))
    assert.equal(host.querySelectorAll('[data-toast]').length, 0, 'and its close button takes it away')
  } finally {
    t.mock.timers.reset()
  }
  const stale = Object.assign(new Error('Conflict'), { status: 409, data: { key: 'error.conflict.stale', params: {} } })
  const host = await render(withToaster(createElement(Form, { kayan: courses, client: draftClient([], async () => {
    throw stale
  }), value: draftRow, t: english, locale: 'en', onDone: () => {}, drafts: { status: 'draft' } })))
  await act(async () => fire(host.querySelector('form')!, 'submit'))
  assert.deepEqual(await toasted(), [], 'a row changed elsewhere is no toast')
  const notice = host.querySelector('[data-stale-notice]')
  assert.ok(notice?.textContent?.includes(english('error.conflict.stale')!), 'it stays on the form, in its own sentence')
  assert.ok(notice?.querySelector('button[data-button="reload"]'), 'beside a reload, since nothing saves until the row is read again')
})

test('240r. a moment\'s time boxes are spin buttons a reader hears the value and range of, the period reads in the clock\'s own order, a pasted 2130 or 9:30 PM is 9:30 PM, and a lone 0 typed over a time keeps it', async () => {
  const reported: unknown[] = []
  const Held = () => {
    const [value, setValue] = useState<unknown>(new Date(2026, 0, 2, 9, 30))
    return createElement(controls.datetime!, {
      values: {}, setValue: () => {}, value, field: fieldOf({ name: 'at', kind: 'datetime' }), kayan: courses, id: 'at', t, locale: 'en',
      readOnly: false, onChange: (next: unknown) => (reported.push(next), setValue(next)),
    })
  }
  const host = await render(createElement(Held))
  const hours = timeSegment(host, 'hours')
  assert.deepEqual(['type', 'inputmode', 'role', 'aria-valuemin', 'aria-valuemax', 'aria-valuenow'].map((name) => hours.getAttribute(name)), ['text', 'numeric', 'spinbutton', '1', '12', '9'], 'the hours are a spin button from 1 to 12, now at 9')
  assert.deepEqual(['aria-valuemin', 'aria-valuemax', 'aria-valuenow'].map((name) => timeSegment(host, 'minutes').getAttribute(name)), ['0', '59', '30'], 'and the minutes from 0 to 59')
  assert.ok(timeSegment(host, 'period').closest('[dir="ltr"]'), 'AM or PM sits in the clock\'s own left-to-right order, so the arrows move across it the same in Arabic')
  await act(async () => press(hours as unknown as Element, '0'))
  assert.deepEqual([timeOf(host), reported.length], ['09:30', 0], 'a lone 0 waits for its second digit and clears nothing')
  for (const pasted of ['2130', '9:30 PM']) {
    await act(async () => typeInto(timeSegment(host, 'hours') as unknown as Element, pasted))
    assert.equal(timeOf(host), '21:30', `${pasted} pasted into the hours is 9:30 in the evening`)
    await act(async () => click(timeSegment(host, 'period') as unknown as Element))
  }
})

test('240s. the summary lists the fields the page draws and links each to the box in its own form, and a refused field the page does not draw is said in a red toast', async () => {
  await toasted()
  const refusal = { status: 400, data: { key: 'error.invalid.value', params: { issues: [{ path: 'title', message: 'A course needs a title.' }, { path: 'fee', message: 'Fee refused.' }] } } }
  const decoy = createElement('form', null, createElement('input', { id: 'courses-title', 'data-decoy': '' }))
  const host = await render(withToaster(createElement('div', null, decoy, createElement(Form, {
    kayan: courses, screen: screenOf(recordPage([{ form: [{ field: 'title' }] }])), client: draftClient([], async () => {
      throw refusal
    }), value: draftRow, t: english, locale: 'en', onDone: () => {},
  }))))
  await act(async () => typeInto(host.querySelector('[data-node="form"] #courses-title')!, 'Tajweed II'))
  await act(async () => fire(host.querySelector('[data-node="form"] form')!, 'submit'))
  await act(async () => sleep(10))
  const summary = host.querySelector('[data-error-summary]')!
  assert.deepEqual([...summary.querySelectorAll('a')].map((one) => one.textContent), ['Title: A course needs a title.'], 'the summary lists the field the page draws')
  assert.deepEqual(await toasted(), ['error: Fee: Fee refused.'], 'and says the one it does not draw in a toast, by its label')
  await act(async () => click(summary.querySelector('a')!))
  await act(async () => sleep(10))
  const focused = window.document.activeElement as unknown as Element | null
  assert.equal(focused?.id === 'courses-title' && !focused.hasAttribute('data-decoy'), true, 'its link focuses the box in its own form, not one of the same id in another')
})

test('240t. a list\'s refused run is said in a red toast and drawn nowhere else, and a bulk run that lands says so in a green one', async () => {
  await toasted()
  let refusing = true
  const docs = [{ id: 'c1', title: 'Tajweed' }, { id: 'c2', title: 'Nahw' }]
  const host = await render(withToaster(createElement(List, {
    kayan: courses, page: pageOf(docs), query: {}, t: english, locale: 'en', onQuery: () => {},
    href: (id: string) => `/courses/${id}`, newHref: '/courses/new', screen: listScreen(), operations: { deleteMany: true, updateMany: true },
    run: async (operation: string) => {
      if (refusing) throw { data: { key: 'error.forbidden.operation', params: { kayan: 'courses', operation } } }
      return { docs: [] }
    },
  })))
  const tick = async () => act(async () => click([...host.querySelectorAll('tbody [role="checkbox"]')][0]! as unknown as Element))
  const deleteTicked = async () => {
    await act(async () => click([...host.querySelectorAll('button')].find((one) => one.textContent?.trim() === 'Delete')! as unknown as Element))
    await confirmYes()
  }
  await tick()
  await deleteTicked()
  assert.deepEqual(await toasted(), ['error: Something went wrong, so nothing was saved. Try again.'], 'the refusal is a red toast, in the shared words where its key has none')
  assert.equal(host.querySelector('[role="alert"]'), null, 'and nothing beside the buttons')
  refusing = false
  await deleteTicked()
  assert.equal((await toasted()).filter((one) => one.startsWith('success: ')).length, 1, 'a bulk run that lands says so')
})

test('240u. the + of a relationship to a kayan that keeps drafts makes its row as Payload\'s drawer does, with Save draft beside Publish, and an answer naming no id picks nothing', async () => {
  await toasted()
  const made: Record<string, unknown>[] = []
  const access = { collections: { courses: { create: true, read: true, operations: { create: true, findVersions: true }, fields: { title: { create: true, read: true } } } } }
  const host = await render(withToaster(createElement(Form, {
    kayan: sessions, screen: screenOf(recordPage([{ form: ['course'] }], '/sessions/new'), sessions), client: recording().client, value: null, t: english, locale: 'en', onDone: () => {},
    kayans, api: fakeApi({ courses: [] }).api,
  })), { client: (async (call: Record<string, unknown>) => (made.push(call), {})) as never, access: access as never })
  await act(async () => click(host.querySelector('button[data-add-new]')!))
  const drawer = documentDrawer()!
  assert.ok(drawer.querySelector('[data-button="save-draft"]') && drawer.querySelector('[data-button="publish"]'), 'the drawer offers Save draft and Publish')
  await act(async () => typeInto(drawer.querySelector('#courses-title')!, 'Tajweed'))
  await act(async () => click(drawer.querySelector('[data-button="save-draft"]')!))
  await act(async () => sleep(0))
  assert.deepEqual(made.map((one) => [one.kayan, one.operation, one.draft]), [['courses', 'create', true]], 'and its draft save is a draft create')
  assert.equal(host.querySelectorAll('[data-slot="combobox-chip"], [data-control="relationship"] input[value]:not([value=""])').length, 0, 'an answer with no id picks nothing')
})


test('audit F01: an operation keeps its footer outside its scrolling fields within the viewport', async () => {
  const { OperationButton } = await import('../registry/operation-button.tsx')
  await render(createElement(OperationButton, {
    busy: false, copy: { t, locale: 'en' }, open: true, inputOf: (values) => values,
    kayan: courses, operation: { name: 'create', effect: 'create', label: { en: 'Create' }, fields: courses.fields.filter((field) => field.kind !== 'join') }, run: async () => true,
  }))
  const dialog = window.document.querySelector('[data-slot="alert-dialog-content"]')!
  assert.match(dialog.className, /max-h-\[calc\(100dvh-/)
  const body = dialog.querySelector('form > [data-operation-fields]')!
  assert.ok(body)
  assert.match(body.className, /overflow-y-auto/)
  assert.ok(body.classList.contains('-m-1') && body.classList.contains('p-1'), 'the scrolling fields leave room around a full-width input focus ring')
  assert.equal(body.contains(dialog.querySelector('[data-slot="alert-dialog-footer"]')!), false)
})


test('audit F06: a record action asks for its fields and holds a refused operation in its dialog', async () => {
  const { ListButton } = await import('../registry/list-button.tsx')
  const sent: Record<string, unknown>[] = []
  const host = await render(createElement(ListButton, {
    kayan: courses, copy: { t, locale: 'en' }, onRefused: () => {},
    operation: { name: 'void', effect: 'update', label: { en: 'Void' }, fields: [fieldOf({ name: 'reason', kind: 'text' })] },
    inputOf: (values) => ({ ...values, id: 'payment' }),
    run: async (_operation, input) => { sent.push(input); throw { data: { key: 'error.invalid.reason' } } },
  }))
  await act(async () => click(host.querySelector('button')!))
  const dialog = window.document.querySelector('[data-slot="alert-dialog-content"]')!
  assert.equal(sent.length, 0)
  await act(async () => typeInto(dialog.querySelector('input') as unknown as Element, 'Duplicate payment'))
  await act(async () => fire(dialog.querySelector('form') as unknown as Element, 'submit'))
  assert.deepEqual(sent, [{ id: 'payment', reason: 'Duplicate payment' }])
  assert.ok(window.document.querySelector('[data-slot="alert-dialog-content"] [role="alert"]'))
  const source = readFileSync(new URL('../registry/host/screens.tsx', import.meta.url), 'utf8')
  assert.match(source, /<ListButton/)
})


test('audit F03: nested tables can shrink through the record form and its tabs', async () => {
  const host = await render(createElement(Form, {
    kayan: courses, screen: screenOf(courses.pages.edit!), client: draftClient([]),
    value: { id: 'c1', title: 'Tajweed' }, t: english, locale: 'en', onDone: () => {},
    related: ({ node }) => createElement(List, {
      kayan: sessions, node, page: pageOf([{ id: 's1', course: 'c1' }]), query: {}, t, locale: 'en', onQuery: () => {}, href: () => '#', newHref: '#', creates: false,
    }),
  }))
  assert.match(host.querySelector('form')!.className, /min-w-0/)
  assert.match(host.querySelector('[data-node="tabs"]')!.className, /min-w-0/)
  const frame = host.querySelector('table')!.parentElement!.parentElement!
  assert.match(frame.className, /max-w-full/)
})


test('audit F04: status tabs scroll within the list instead of widening the page', async () => {
  const host = await render(createElement(List, {
    kayan: courses, page: pageOf([]), query: {}, t, locale: 'ar', onQuery: () => {}, href: () => '#', newHref: '#', creates: false,
    node: { columns: [{ field: 'title' }], tabs: ['all', 'draft', 'issued', 'cancelled'].map((tab) => ({ tab, label: { ar: tab } })) },
  }))
  const strip = host.querySelector('[data-slot="tabs-list"]')!
  assert.match(strip.className, /max-w-full/)
  assert.match(strip.className, /overflow-x-auto/)
  assert.ok(strip.classList.contains('overflow-y-hidden'), 'the strip scrolls only sideways')
  assert.ok(strip.classList.contains('pb-2'), 'bottom space keeps the active underline inside the scrolling strip')
  assert.ok(strip.classList.contains('min-h-12'), 'the strip grows around phone-height triggers and their focus rings')
  assert.match(strip.className, /justify-start/)
})


test('audit F21: standalone operation dialogs omit row-selection plumbing', async () => {
  const { OperationButton } = await import('../registry/operation-button.tsx')
  await render(createElement(OperationButton, {
    kayan: courses, busy: false, copy: { t, locale: 'en' }, open: true, inputOf: (values) => values,
    operation: { name: 'create', effect: 'create', label: { en: 'Create' } }, run: async () => true,
  }))
  assert.equal(window.document.querySelector('[data-slot="alert-dialog-description"]') === null, true)
  const source = readFileSync(new URL('../registry/list.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /admin\.toolbarWarning/)
})


test('audit F25: custom field controls receive the label and refusal ids for their input', async () => {
  const { LeafControl } = await import('../registry/leaf-control.tsx')
  const custom = 'custom.tsx#Control'
  const Input = (props: import('mithaq/admin').ControlProps & { id?: string; describedBy?: string }) => createElement('input', { id: props.id, 'aria-describedby': props.describedBy })
  const host = await render(createElement(LeafControl, {
    kayan: courses, field: fieldOf({ name: 'amount', kind: 'decimal', component: custom, description: { en: 'Amount in riyals' } }),
    screen: screenOf(recordPage([]), courses, { [custom]: Input }), copy: { t, locale: 'en' }, value: '12.50', values: {}, setValue: () => {}, onChange: () => {}, readOnly: false, error: 'Invalid amount',
  }))
  const input = host.querySelector('input')!
  assert.equal(input.id, host.querySelector('label')!.htmlFor)
  assert.equal(input.getAttribute('aria-describedby'), 'courses-amount-description courses-amount-error')
})


test('audit F02: a refreshed row replaces touched form values even when its updatedAt did not move', async () => {
  function Parent() {
    const [value, setValue] = useState({ id: 'c1', title: 'Before', updatedAt: '2026-10-19T10:00:00Z' })
    return createElement(Form, {
      kayan: courses, screen: screenOf(recordPage([{ form: [{ field: 'title' }] }, { button: 'archive', label: { en: 'Archive' } }])),
      client: { ...draftClient([]), run: async () => ({ id: 'c1' }) }, value, t, locale: 'en', operations: { archive: true, update: true },
      onDone: () => setValue({ ...value, title: 'After' }),
    })
  }
  const host = await render(createElement(Parent))
  await act(async () => typeInto(host.querySelector('input[name="title"]')!, 'Typed'))
  await act(async () => click([...host.querySelectorAll('button')].find((button) => button.textContent === 'Archive')! as unknown as Element))
  const dialog = window.document.querySelector('[data-slot="alert-dialog-content"]')!
  await act(async () => fire(dialog.querySelector('form') as unknown as Element, 'submit'))
  assert.equal((host.querySelector('input[name="title"]') as HTMLInputElement).value, 'After')
  const source = readFileSync(new URL('../registry/host/screens.tsx', import.meta.url), 'utf8')
  assert.match(source, /name !== kayan\.name.*router\.invalidate/s)
})


test('audit F22: delayed hydration of the generic updated timestamp reports no mismatch', async () => {
  const { FormActions } = await import('../registry/form-actions.tsx')
  const { renderToString } = await import('react-dom/server')
  const { hydrateRoot } = await import('react-dom/client')
  let now = Date.parse('2026-10-19T10:01:00Z')
  const clock = mock.method(Date, 'now', () => now)
  const draw = () => createElement(FormActions, {
    header: true, t, locale: 'en', updated: new Date('2026-10-19T10:00:00Z'), busy: false, dirty: false, updating: true,
    viewing: false, drafts: false, formId: 'probe', onAsk: () => {}, onSaveDraft: () => {},
  })
  const host = mount()
  const problems: unknown[] = []
  let root: ReturnType<typeof hydrateRoot> | undefined
  try {
    host.innerHTML = renderToString(draw())
    now += 120_000
    await act(async () => { root = hydrateRoot(host, draw(), { onRecoverableError: (error) => problems.push(error) }) })
    assert.equal(problems.length, 0, problems.map(String).join(' | '))
  } finally {
    await act(async () => root?.unmount())
    clock.mock.restore()
  }
})


test('audit F02b: a child refresh updates clean touched fields and keeps unsaved parent edits', async () => {
  function Parent() {
    const [value, setValue] = useState({ id: 'c1', title: 'Before', summary: 'Old summary', updatedAt: '2026-10-19T10:00:00Z' })
    return createElement('div', null,
      createElement('button', { id: 'refresh-parent', onClick: () => setValue({ ...value, title: 'After', summary: value.summary === 'Old summary' ? 'Fresh summary 1' : 'Fresh summary 2' }) }, 'Refresh'),
      createElement(Form, { kayan: courses, screen: screenOf(recordPage([{ form: [{ field: 'title' }, { field: 'summary' }] }])), client: draftClient([]), value, t, locale: 'en', onDone: () => {} }),
    )
  }
  const host = await render(createElement(Parent))
  const title = () => host.querySelector('input[name="title"]') as HTMLInputElement
  await act(async () => typeInto(title(), 'Edited'))
  await act(async () => typeInto(title(), 'Before'))
  await act(async () => click(host.querySelector('#refresh-parent')!))
  assert.equal(title().value, 'After')
  await act(async () => typeInto(title(), 'Unsaved'))
  await act(async () => click(host.querySelector('#refresh-parent')!))
  assert.equal(title().value, 'Unsaved')
  assert.equal((host.querySelector('[name="summary"]') as HTMLTextAreaElement).value, 'Fresh summary 2')
})

test('audit F22: Arabic date pickers hydrate across ICU punctuation differences', async () => {
  const { DatePicker } = await import('../registry/date-control.tsx')
  const { renderToString } = await import('react-dom/server')
  const { hydrateRoot } = await import('react-dom/client')
  const descriptor = Object.getOwnPropertyDescriptor(Intl.DateTimeFormat.prototype, 'format')!
  const host = mount()
  const problems: unknown[] = []
  const draw = () => createElement(DatePicker, { kayan: courses, field: fieldOf({ name: 'at', kind: 'datetime' }),
    id: 'at', value: '2026-10-19T08:00:00Z', locale: 'ar', t, readOnly: false, values: {}, setValue: () => {}, onChange: () => {},
  })
  let root: ReturnType<typeof hydrateRoot> | undefined
  try {
    Object.defineProperty(Intl.DateTimeFormat.prototype, 'format', { configurable: true, get() { return () => '19 أكتوبر، 2026' } })
    host.innerHTML = renderToString(draw())
    Object.defineProperty(Intl.DateTimeFormat.prototype, 'format', { configurable: true, get() { return () => '19 أكتوبر 2026' } })
    await act(async () => { root = hydrateRoot(host, draw(), { onRecoverableError: (error) => problems.push(error) }) })
    assert.deepEqual(problems, [])
    assert.equal(host.querySelector('#at-day')?.textContent, '19 أكتوبر 2026')
  } finally {
    Object.defineProperty(Intl.DateTimeFormat.prototype, 'format', descriptor)
    await act(async () => root?.unmount())
  }
})

test('read-only values and controls retain inherited field descriptions', async () => {
  const { FieldValue } = await import('../registry/field-value.tsx')
  const { LeafControl } = await import('../registry/leaf-control.tsx')
  const field = fieldOf({ name: 'title', kind: 'text', description: { en: 'The course name shown to students.' } })
  const value = await render(createElement(FieldValue, { kayan: courses, field, row: { title: 'Buyer' }, copy: { t, locale: 'en' } }))
  assert.equal(value.textContent?.includes('The course name shown to students.'), true)
  const control = await render(createElement(LeafControl, { kayan: courses, field, value: '', copy: { t, locale: 'en' },
    form: 'create', values: {}, setValue: () => {}, onChange: () => {}, readOnly: false,
  }))
  assert.ok(control.textContent?.includes('The course name shown to students.'))
})


test('date pickers show no day before mount and hydrate to the local day across midnight', async () => {
  const { DatePicker } = await import('../registry/date-control.tsx')
  const { renderToString } = await import('react-dom/server')
  const { hydrateRoot } = await import('react-dom/client')
  const host = mount()
  const problems: unknown[] = []
  const draw = () => createElement(DatePicker, { kayan: courses, field: fieldOf({ name: 'at', kind: 'datetime' }),
    id: 'at', value: '2026-10-19T22:00:00Z', locale: 'en', t, readOnly: false, values: {}, setValue: () => {}, onChange: () => {},
  })
  let root: ReturnType<typeof hydrateRoot> | undefined
  try {
    process.env.TZ = 'UTC'
    host.innerHTML = renderToString(draw())
    assert.equal(host.querySelector('#at-day')?.textContent, '')
    assert.ok(host.querySelector('#at-day [aria-hidden="true"]'))
    process.env.TZ = 'Asia/Riyadh'
    await act(async () => { root = hydrateRoot(host, draw(), { onRecoverableError: (error) => problems.push(error) }) })
    assert.deepEqual(problems, [])
    assert.equal(host.querySelector('#at-day')?.textContent, 'October 20, 2026')
  } finally {
    process.env.TZ = homeZone
    await act(async () => root?.unmount())
  }
})


test('B2 the provider member directory pages, sorts and links each member to their own page', async () => {
  const people = Array.from({ length: 26 }, (_, at) => ({ ...omar, userId: `p${at}`, name: `Person ${String(at).padStart(2, '0')}` }))
  const { host, rows } = await membersPage({ loaderData: { members: people, roles: [] }, permissions: ['member.find'] })
  assert.equal(rows().length, 25)
  assert.equal(host.querySelector('[data-mithaq-range]')?.getAttribute('data-mithaq-range'), '1-25/26')
  assert.equal(host.querySelector('tbody a')?.getAttribute('href'), '/dashboard/members/p0')
  const name = [...host.querySelectorAll('thead button')].find((one) => one.textContent?.includes('Name'))!
  await act(async () => click(name))
  await act(async () => click(name))
  assert.equal(rows()[0], 'p25')
  const next = [...host.querySelectorAll('button')].find((one) => one.textContent === 'Next')!
  await act(async () => click(next))
  assert.deepEqual(rows(), ['p0'])
})


test('B2 a member page shows identity, role permissions and an application section without an overlay', async () => {
  const { MemberPage } = await import('../registry/members.tsx')
  const { membersOptions } = await import('../../../templates/asas/src/ui-dashboard/members.tsx')
  const host = await render(createElement(MemberPage, { member: layla, roles: [teacher], options: membersOptions, children: createElement('section', { 'data-shops': '' }, 'Shops') }), { t: english, access: { permissions: '*', collections: { memberRoles: { create: true, delete: true } } } as never })
  assert.equal(host.querySelector('h1')?.textContent, 'Layla')
  assert.ok(host.querySelector('[data-member-page]')?.textContent?.includes('layla@example.com'))
  assert.ok(host.querySelector('[data-role="teacher"] [data-group="courses"]'))
  assert.equal(host.querySelector('[data-document-drawer]'), null)
  assert.ok(host.querySelector('[data-shops]'))
})


test('B2 role permission editing uses plain grouped checkboxes and expandable fields', async () => {
  const { PermissionBadges } = await import('../../../templates/features/roles/roles/ui/role-form.tsx')
  const chosen: string[][] = []
  const host = await render(createElement(PermissionBadges, { held: ['courses.find', 'courses.fields.title'], onChange: (keys: string[]) => chosen.push(keys) }), { t: english, access: { screens: ['dashboard'], permissions: ['courses.find', 'courses.fields.title'] } as never })
  const find = host.querySelector('[data-key="courses.find"] input[type="checkbox"]')!
  assert.ok(find)
  assert.equal((find as HTMLInputElement).checked, true)
  await act(async () => click(find.parentElement!.querySelector('span')!))
  assert.deepEqual(chosen, [['courses.fields.title']])
  assert.equal(host.querySelector('[data-key="courses.create"] input[type="checkbox"]')?.hasAttribute('disabled'), true)
  assert.ok(host.querySelector('details[data-field-access="courses"]'))
  assert.ok(host.querySelector('input[type="search"]') === null)
  assert.ok(host.querySelector('[data-selected-only]') === null)
})


test('B2 the roles list counts assigned members and links fixed roles to read-only pages', async () => {
  const { RolesTable } = await import('../registry/roles.tsx')
  const list = { page: { docs: [{ id: 'r1', name: 'teacher', label: { en: 'Teacher' }, permissions: ['courses.find'] }, { id: 'r2', label: { en: 'Unread name' } }, { id: 'r3', name: 'constructor', label: { en: 'No assignments' } }] }, creates: false, href: (id: string) => `/dashboard/roles/${id}` }
  const host = await render(createElement(ListContext, { value: list as never }, createElement(RolesTable, { roles: [administrator], counts: { administrator: 1, teacher: 2 } })), { t: english })
  assert.equal(host.querySelector('[data-row="administrator"] a')?.getAttribute('href'), '/dashboard/roles/fixed/administrator')
  assert.equal(host.querySelector('[data-row="administrator"] [data-member-count] [data-list-value]')?.textContent, '1')
  assert.equal(host.querySelector('[data-row="r1"] [data-member-count] [data-list-value]')?.textContent, '2')
  assert.equal(host.querySelector('[data-row="r1"] a')?.getAttribute('href'), '/dashboard/roles/r1')
  assert.equal(host.querySelector('[data-row="r2"] [data-member-count] [data-list-value]')?.textContent, '—', 'a masked role name cannot be joined to its assignment count')
  assert.equal(host.querySelector('[data-row="r3"] [data-member-count] [data-list-value]')?.textContent, '0', 'role names do not read inherited object properties as counts')
})


test('B2 a partial assignment save reports the refusal and shows only the writes that landed', async () => {
  const { MemberPage } = await import('../registry/members.tsx')
  const { membersOptions } = await import('../../../templates/asas/src/ui-dashboard/members.tsx')
  const writes: string[] = []
  const roles = [teacher, { name: 'aide', fixed: false, permissions: ['tags.find'] }]
  const host = await render(createElement(MemberPage, { member: layla, roles, options: membersOptions }), { t: english, access: { permissions: '*', collections: { memberRoles: { create: true, delete: true } } } as never, client: async ({ operation }) => {
    writes.push(operation)
    if (operation === 'create') throw { data: { key: 'refused' } }
    return {}
  } })
  for (const name of ['teacher', 'aide']) await act(async () => click(host.querySelector(`[data-role="${name}"] .font-medium`)!))
  await act(async () => click([...host.querySelectorAll('button')].find((one) => one.textContent === 'Save')!))
  assert.deepEqual(writes, ['delete', 'create'])
  assert.ok(host.querySelector('[role="alert"]'))
  assert.equal(host.querySelector('[data-role="teacher"] [role="checkbox"]')?.getAttribute('aria-checked'), 'false')
  assert.equal(host.querySelector('[data-role="aide"] [role="checkbox"]')?.getAttribute('aria-checked'), 'false')
})


test('B2 a custom role holding every permission can replace that grant through its editor', async () => {
  const { PermissionBadges } = await import('../../../templates/features/roles/roles/ui/role-form.tsx')
  const changed: string[][] = []
  const host = await render(createElement(PermissionBadges, { held: ['*'], onChange: (keys: string[]) => changed.push(keys) }), { t: english, access: { permissions: '*' } as never })
  const all = host.querySelector('[data-key="*"] input')!
  assert.ok(all)
  await act(async () => click(all))
  assert.deepEqual(changed, [[]])
})


test('B2 member identity dates and permission summaries follow the actor access', async () => {
  const { MemberPage } = await import('../registry/members.tsx')
  const { membersOptions } = await import('../../../templates/asas/src/ui-dashboard/members.tsx')
  for (const permissions of [['member.find'], ['member.find', 'roles.find', 'member.fields.lastSeenAt']]) {
    const readsRoles = permissions.includes('roles.find')
    const host = await render(createElement(MemberPage, { member: layla, roles: [administrator, teacher], options: membersOptions }), { t: english, access: { permissions } as never })
    assert.equal(Boolean(host.querySelector('[data-role-summary]')), readsRoles)
    assert.ok(![...host.querySelectorAll('button')].some((one) => ['Save', 'Cancel'].includes(one.textContent ?? '')))
    const identity = host.querySelector('[data-member-sheet] > p')!.textContent!
    assert.ok(identity.includes('Joined') && identity.includes('October 1, 2026'))
    assert.equal(identity.includes('Last seen'), readsRoles)
    assert.equal(identity.includes('October 14, 2026'), readsRoles)
  }
})


test('B2 role counts survive host renders with a rebuilt client and access report', async () => {
  const { RolesTable } = await import('../../../templates/features/roles/roles/ui/roles.tsx')
  const fetched = mock.method(globalThis, 'fetch', async () => Response.json({ members: [{ userId: 'u1', role: 'member' }], total: 1 }))
  const reads: string[] = []
  const tree = (permissions: string[]) => createElement(ScreenContext, { value: { ...state, access: { permissions } as never, client: async () => {
    reads.push('assignments')
    return { docs: [{ user: 'u1', role: 'instructor' }], totalDocs: 1 }
  } } }, createElement(ListContext, { value: { page: { docs: [] }, creates: false, href: () => '#' } as never }, createElement(RolesTable)))
  try {
    const permissions = ['member.find', 'memberRoles.find']
    const host = await render(tree(permissions), { t: english })
    assert.equal(fetched.mock.callCount(), 1)
    await act(async () => mounted!.render(createElement(ScreenContext, { value: { ...state, t: english } }, withComponents(tree([...permissions])))))
    assert.equal(fetched.mock.callCount(), 1)
    assert.deepEqual(reads, ['assignments'])
    await act(async () => mounted!.render(createElement(ScreenContext, { value: { ...state, t: english } }, withComponents(tree(['member.find'])))))
    assert.equal(host.querySelector('[data-member-count] [data-list-value]')?.textContent, '—')
  } finally { fetched.mock.restore() }
})


test('B2 member row opening and Cancel click the host links', async () => {
  const { host } = await membersPage({ loaderData: { members: [layla], roles: [teacher] }, permissions: ['member.find'] })
  const opened: string[] = []
  host.querySelector('a[data-row-link]')!.addEventListener('click', (event) => { event.preventDefault(); opened.push('member') })
  await act(async () => press(host.querySelector('tbody tr')!, 'Enter'))
  assert.deepEqual(opened, ['member'])
  const { MemberPage } = await import('../registry/members.tsx')
  const { membersOptions } = await import('../../../templates/asas/src/ui-dashboard/members.tsx')
  const page = await render(createElement(MemberPage, { member: layla, roles: [teacher], options: membersOptions }), { t: english, access: { permissions: '*', collections: { memberRoles: { create: true } } } as never })
  page.querySelector('[data-header-actions] a')!.addEventListener('click', (event) => { event.preventDefault(); opened.push('directory') })
  await act(async () => click(page.querySelector('[data-header-actions] a')!))
  assert.deepEqual(opened, ['member', 'directory'])
})

test('record tabs restore a URL selection, keep values mounted and follow hash navigation', async () => {
  window.history.replaceState(null, '', '/dashboard/courses/c1?search=kept#tab.details=activity')
  const host = mount()
  const root = createRoot(host)
  const { TabsNode } = await import('../registry/node-groups.tsx')
  const node = { tabs: [
    { tab: 'details', label: { en: 'Details' }, fields: [{ field: 'title' }] },
    { tab: 'activity', label: { en: 'Activity' }, fields: [{ field: 'fee' }] },
  ] }
  const draw = { kayan: courses, copy: { t, locale: 'en' }, issues: {}, scope: {}, control: (leaf: { field: string }) => createElement('input', { name: leaf.field, defaultValue: 'Kept' }) }
  try {
    await act(async () => root.render(withComponents(createElement(TabsNode, { node, draw, index: 0, inRow: false } as never))))
    const tabs = () => [...host.querySelectorAll<HTMLElement>('[role=tab]')]
    assert.equal(tabs().find((tab) => tab.getAttribute('aria-selected') === 'true')?.textContent, 'Activity')
    assert.equal(host.querySelectorAll('input').length, 2, 'inactive fields remain mounted')
    await act(async () => click(tabs()[0]!))
    assert.equal(new URLSearchParams(window.location.hash.slice(1)).get('tab.details'), 'details')
    assert.equal(window.location.search, '?search=kept')
    await act(async () => {
      window.history.replaceState(null, '', '#tab.details=activity')
      window.dispatchEvent(new window.HashChangeEvent('hashchange'))
    })
    assert.equal(tabs().find((tab) => tab.getAttribute('aria-selected') === 'true')?.textContent, 'Activity')
    await act(async () => {
      window.history.replaceState(null, '', '#tab.details=forbidden')
      window.dispatchEvent(new window.HashChangeEvent('hashchange'))
    })
    assert.equal(tabs().find((tab) => tab.getAttribute('aria-selected') === 'true')?.textContent, 'Details', 'an unknown or pruned tab falls back to the first visible one')
  } finally {
    await act(async () => root.unmount())
    host.remove()
    window.history.replaceState(null, '', '/')
  }
})

test('backoffice record actions remain visible and omit actions the viewer cannot run', async () => {
  const { UserButtons } = await import('../../../templates/asas/src/ui-backoffice/user-actions.tsx')
  const own = { id: 'staff', email: state.user.email, role: 'super_admin' }
  const denied = await render(createElement(UserButtons), { record: own, access: { permissions: '*' } })
  assert.equal(denied.querySelector('[aria-label="More actions"]'), null, 'the viewer has no actions on their own record')
  const allowed = await render(createElement(UserButtons), { record: { ...own, id: 'other', email: 'other@example.test', role: 'user' }, access: { permissions: '*' } })
  assert.equal(allowed.querySelector('[aria-label="More actions"]'), null)
  assert.deepEqual([...window.document.querySelectorAll('[data-person-actions] [data-action]')].map((button) => button.getAttribute('data-action')), ['set-role', 'ban', 'impersonate'])
})

test('a custom role record denied update reads values and permissions without disabled editor controls', async () => {
  const { RoleForm } = await import('../../../templates/features/roles/roles/ui/role-form.tsx')
  const roles = screen.kayan.roles!
  const value = { id: 'r1', name: 'reader', label: { en: 'Reader', ar: 'قارئ' }, permissions: ['tags.find'] }
  const custom = recordPage([{ form: [{ field: 'name' }, { field: 'label' }, { field: 'permissions' }], component: 'role-form' }])
  const host = await render(createElement(Form, {
    kayan: roles, value, client: draftClient([]), screen: screenOf(custom, roles, { 'role-form': RoleForm }),
    operations: { update: false }, t, locale: 'en', onDone: () => {},
  }), { kayan: roles, record: value, access: { collections: { roles: { operations: { update: false } } } } as never })
  assert.equal(host.querySelectorAll('dl[data-field-value]').length, 3)
  assert.ok(host.textContent?.includes('Reader'))
  assert.ok(host.querySelector('[data-permissions] [data-key="tags.find"]'))
  assert.equal(host.querySelector('input, textarea, button[data-key]'), null)
  assert.equal([...host.querySelectorAll('button')].some((button) => button.textContent === 'Save'), false)
})


test('More shares the responsive form action bar while status stays in the header', async () => {
  const { PageHeader } = await import('../registry/page-header.tsx')
  const { FormActions } = await import('../registry/form-actions.tsx')
  const host = await render(createElement(PageHeader, {
    t, title: 'Record', more: createElement('button', {}, 'Archive'),
    primary: createElement(FormActions, {
      header: true, t, locale: 'en', status: 'draft', busy: false, dirty: true,
      updating: true, viewing: false, drafts: true, formId: 'record-form',
      onAsk: () => {}, onSaveDraft: () => {},
    }),
  }))
  const bar = host.querySelector('[data-action-bar]')!
  assert.ok(bar.querySelector('[data-button=publish]'))
  assert.ok(bar.querySelector('[aria-label="More actions"]'))
  assert.equal(bar.querySelector('[data-status]'), null)
  assert.ok(host.querySelector('[data-status=draft]'))

})


test('backoffice role permissions keep collapsed badge groups', async () => {
  const { PermissionBadges } = await import('../../../templates/features/roles/roles/ui/role-form.tsx')
  const host = await render(createElement(PermissionBadges, { held: ['screen.dashboard', 'courses.find', 'courses.fields.title'] }), {
    screen: asas.targets.backoffice.client, t: english, access: { screens: ['backoffice'], permissions: '*' },
  })
  const group = host.querySelector('[data-group="courses"]')!
  assert.equal(group.querySelector('button')?.getAttribute('aria-expanded'), 'false')
  assert.equal(group.querySelector('[data-key="courses.find"]')?.getAttribute('data-slot'), 'badge')
  assert.equal(group.querySelector('[data-key="courses.fields.title"]')?.getAttribute('data-slot'), 'badge')
})


test('member and fixed role pages use the shell breadcrumb and member header actions submit their form', async () => {
  const { MemberPage } = await import('../registry/members.tsx')
  const { membersOptions } = await import('../../../templates/asas/src/ui-dashboard/members.tsx')
  const host = await render(createElement(MemberPage, { member: layla, roles: [teacher], options: membersOptions }), { t: english, access: { permissions: '*', collections: { memberRoles: { create: true, delete: true } } } as never })
  assert.equal(host.querySelector('[data-page-header] [data-back]')?.getAttribute('href'), '/dashboard/members')
  const save = host.querySelector<HTMLButtonElement>('[data-header-actions] button[type="submit"]')!
  assert.ok(save)
  assert.equal(save.getAttribute('form'), host.querySelector('form[data-member-sheet]')?.id)
  assert.ok(save.closest('[data-action-bar]'))
  assert.equal(save.disabled, true)
  await act(async () => click(host.querySelector('[data-role="teacher"] .font-medium')!))
  assert.equal(save.disabled, false)
  const { FixedRole } = await import('../../../templates/asas/src/ui-dashboard/fixed-role.tsx')
  const { tenantRoles } = await import('../../../templates/mithaq/src/roles/tenant-roles.ts')
  const fixed = await render(createElement(FixedRole, { loaderData: { name: 'administrator', role: tenantRoles.administrator } } as never), { t: english })
  assert.equal(fixed.querySelector('[data-page-header] [data-back]')?.getAttribute('href'), '/dashboard/roles')
})


test('permission checkboxes use canGrant for each key', async () => {
  const { Permissions } = await import('../registry/role-form.tsx')
  const host = await render(createElement(Permissions, { held: [], onChange: () => {}, options: { statements: {}, canGrant: (keys) => keys.every((key) => key === 'courses.find') } }))
  assert.equal(host.querySelector<HTMLInputElement>('[data-key="courses.find"] input')?.disabled, false)
  assert.equal(host.querySelector<HTMLInputElement>('[data-key="courses.create"] input')?.disabled, true)
})


test('a long Arabic select value exposes its full label before and after a selection', async () => {
  const long = 'الضريبة الافتراضية للمنشأة'
  const field = fieldOf({ name: 'tax', kind: 'text', options: [
    { value: 'default', label: { ar: long } }, { value: 'other', label: { ar: `${long} الأخرى` } },
  ] })
  function Pick() {
    const [value, onChange] = useState<unknown>('default')
    return createElement(controls.select!, { field, kayan: courses, id: 'tax', t, locale: 'ar', value, values: {}, setValue: () => {}, readOnly: false, onChange })
  }
  const host = await render(createElement(Pick))
  assert.equal(host.querySelector('[data-slot=select-value]')?.getAttribute('title'), long)
  await act(async () => click(host.querySelector('[data-slot=select-trigger]')!))
  await act(async () => click([...window.document.querySelectorAll('[data-slot=select-item]')].find((node) => node.textContent === `${long} الأخرى`)! as unknown as Element))
  assert.equal(host.querySelector('[data-slot=select-value]')?.getAttribute('title'), `${long} الأخرى`)
})


test('a long Arabic combobox exposes the complete input value', async () => {
  const long = 'الضريبة الافتراضية للمنشأة'
  const host = await render(createElement(controls.combobox!, {
    field: fieldOf({ name: 'tax', kind: 'text', options: [{ value: 'default', label: { ar: long } }] }),
    kayan: courses, id: 'tax', t, locale: 'ar', value: 'default', values: {}, setValue: () => {}, readOnly: false, onChange: () => {},
  }))
  const input = host.querySelector('[role=combobox]') as HTMLInputElement
  assert.equal(input.value, long)
  assert.equal(input.title, long)
})

test('phone list sorting offers readable sortable columns, both directions and the declared order without losing the query', async () => {
  const shown = { ...courses, fields: [
    fieldOf({ name: 'title', kind: 'text', label: { en: 'Title', ar: 'العنوان' } }),
    fieldOf({ name: 'fee', kind: 'number', label: { en: 'Fee', ar: 'الرسوم' } }),
    fieldOf({ name: 'details', kind: 'text', label: { en: 'Details', ar: 'التفاصيل' }, sortable: false }),
    fieldOf({ name: 'private', kind: 'text', label: { en: 'Private', ar: 'خاص' }, rules: { localized: true } }),
  ] }
  const queries: import('../registry/list-query.ts').ListQuery[] = []
  const host = await render(createElement(List, {
    kayan: shown, page: pageOf([{ id: 'c1', title: 'Tajweed', fee: 300, details: 'A long description' }]),
    query: { page: 3, search: 'taj', sort: '-fee', cols: ['title', 'fee', 'details'] }, t, locale: 'en',
    onQuery: (query) => queries.push(query), href: (id: string) => `/courses/${id}`, newHref: '/courses/new',
  }))
  const trigger = host.querySelector('[aria-label="Sort by"]')!
  assert.ok(trigger, 'the phone has a named sort control instead of cut-off column headings')
  assert.equal(trigger.closest('table') === null, true, 'sorting is a list control, never a column header')
  assert.equal(host.querySelector('table')?.parentElement === host.querySelector('[data-list-frame]')?.firstElementChild, true)
  assert.equal(host.querySelectorAll('tbody [data-row-link]').length, 1, 'one cell tree per row, shared by the phone and desktop layouts')
  await act(async () => click(trigger as unknown as Element))
  const options = [...window.document.querySelectorAll('[role="option"]')]
  assert.deepEqual(options.map((option) => option.textContent), ['Default order', 'Title: Ascending', 'Title: Descending', 'Fee: Ascending', 'Fee: Descending'])
  await act(async () => click(options.find((one) => one.textContent === 'Fee: Ascending')! as unknown as Element))
  assert.deepEqual(queries.at(-1), { page: 1, search: 'taj', sort: 'fee', cols: ['title', 'fee', 'details'] })
  await act(async () => click(trigger as unknown as Element))
  await act(async () => click([...window.document.querySelectorAll('[role="option"]')].find((one) => one.textContent === 'Title: Descending')! as unknown as Element))
  assert.equal(queries.at(-1)?.sort, '-title')
  await act(async () => click(trigger as unknown as Element))
  await act(async () => click([...window.document.querySelectorAll('[role="option"]')].find((one) => one.textContent === 'Default order')! as unknown as Element))
  assert.deepEqual(queries.at(-1), { page: 1, search: 'taj', sort: undefined, cols: ['title', 'fee', 'details'] }, 'the reset lets the declared list sort apply again')
})

test('phone cards keep one row link and checkbox, labelled details, and independent row actions', async () => {
  const { listOf } = await import('../registry/node-tree.ts')
  const node = { ...listOf(listScreen())!, card: undefined }
  const host = await render(createElement(List, {
    kayan: courses, screen: listScreen(), node, page: pageOf([{ id: 'c1', title: 'Tajweed', fee: 300, currency: 'SAR', delivery: 'live' }]),
    query: { cols: ['title', 'fee', 'currency', 'delivery', 'createdAt'] }, t: english, locale: 'en', onQuery: () => {},
    href: (id: string) => `/courses/${id}`, newHref: '/courses/new', operations: { deleteMany: true, delete: true }, run: async () => ({}),
  }))
  const row = host.querySelector('tr[data-row="c1"]')!
  assert.equal(row.querySelectorAll('[data-list-title]').length, 1)
  assert.deepEqual([...row.querySelectorAll('[data-list-detail]:not([data-list-extra]) [data-list-label]')].map((one) => one.textContent), ['Fee:', 'Currency:', 'Delivery:'])
  assert.ok(row.querySelector('[data-list-extra]'), 'further columns stay available to the desktop table')
  assert.equal(row.querySelectorAll('[role="checkbox"]').length, 1)
  assert.equal(host.querySelectorAll('thead [role="checkbox"]').length, 1)
  assert.ok([...row.querySelectorAll('[data-list-label]')].every((label) => label.getAttribute('aria-hidden') === 'true'), 'visible labels do not repeat the accessible column header')
  let opened = 0
  row.querySelector('a[data-row-link]')!.addEventListener('click', (event) => { event.preventDefault(); opened++ })
  await act(async () => click(row.querySelector('[data-list-label]')! as unknown as Element))
  assert.equal(opened, 1, 'tapping a detail opens the row through its host-routed link')
  await act(async () => press(row as unknown as Element, 'Enter'))
  assert.equal(opened, 2)
  await act(async () => click(row.querySelector('[role="checkbox"]')! as unknown as Element))
  assert.equal(opened, 2, 'selection never opens the row')
  await act(async () => click(row.querySelector('[data-row-menu]')! as unknown as Element))
  assert.equal(opened, 2, 'the actions menu never opens the row')
  assert.ok(window.document.querySelector('[data-row-action="delete"]'))
})

test('the dedicated roles list uses the same labelled phone card layout without replacing its desktop table', async () => {
  const { RolesTable } = await import('../registry/roles.tsx')
  const list = { page: pageOf([{ id: 'r1', name: 'reviewer', label: { en: 'Reviewer' } }]), creates: false, href: (id: string) => `/roles/${id}` }
  const host = await render(createElement(ListContext, { value: list as never }, createElement(RolesTable, { roles: [], counts: { reviewer: 2 } })), { t: english })
  const card = host.querySelector('[data-roles] [data-list-card]')
  assert.ok(card)
  assert.equal(card.closest('table') !== null, true)
  assert.ok([...card.querySelectorAll('[data-list-label]')].every((label) => label.getAttribute('aria-hidden') === 'true'))
  assert.equal(card.querySelector('[data-list-title] a')?.getAttribute('href'), '/roles/r1')
  assert.deepEqual([...card.querySelectorAll('[data-list-label]')].map((one) => one.textContent), ['Kind:', 'Members:'])
})

for (const [name, cols, reads, expected] of [
  ['declared order', ['title', 'fee', 'currency', 'delivery', 'createdAt'], undefined, ['Created at:', 'Delivery:', 'Fee:']],
  ['hidden column', ['title', '-fee', 'currency', 'delivery', 'createdAt'], undefined, ['Created at:', 'Delivery:']],
  ['unreadable column', ['title', 'fee', 'currency', 'delivery', 'createdAt'], (_kayan: string, field: string) => field !== 'delivery', ['Created at:', 'Fee:']],
] as const) test(`phone card respects ${name} without filling from outside card`, async () => {
  const screen = listScreen()
  const { listIn, nodesOf } = await import('../registry/node-tree.ts')
  const page = structuredClone(screen.page)
  listIn(nodesOf(page))!.columns = ['title', 'fee', 'currency', 'delivery', 'createdAt'].map((field) => ({ field }))
  listIn(nodesOf(page))!.card = ['createdAt', 'delivery', 'fee']
  const host = await render(createElement(List, {
    kayan: courses, screen: { ...screen, page }, page: pageOf([{ id: 'c1', title: 'Tajweed', fee: 300, currency: 'SAR', delivery: 'live' }]),
    query: { cols: [...cols] }, reads, t: english, locale: 'en', onQuery: () => {},
    href: (id: string) => `/courses/${id}`, newHref: '/courses/new',
  }))
  const row = host.querySelector('tr[data-row="c1"]')!
  const details = [...row.querySelectorAll('[data-list-detail]:not([data-list-extra])')].sort((a, b) => Number(a.getAttribute('data-list-card-order')) - Number(b.getAttribute('data-list-card-order')))
  assert.deepEqual(details.map((cell) => cell.querySelector('[data-list-label]')?.textContent), expected)
  assert.equal(row.querySelectorAll('td').length, cols.filter((column) => !column.startsWith('-')).length + 1 - (reads ? 1 : 0), 'desktop retains every readable selected column and actions')
})

for (const phone of [undefined, 'cards', 'table'] as const) test(`a list declares its phone layout ${phone ?? 'by default'} without a runtime switch`, async () => {
  const { listOf } = await import('../registry/node-tree.ts')
  const node = { ...listOf(listScreen())!, card: undefined, ...(phone && { phone }) }
  const host = await render(createElement(List, {
    kayan: courses, node, page: pageOf([{ id: 'c1', title: 'Tajweed', fee: 300 }]),
    query: {}, t: english, locale: 'en', onQuery: () => {}, href: (id: string) => `/courses/${id}`, newHref: '/courses/new',
  }))
  assert.equal(host.querySelector('[data-list-frame]')?.getAttribute('data-list-phone'), phone === 'table' ? 'table' : null)
  assert.equal(host.querySelectorAll('[data-list-phone-controls]').length, phone === 'table' ? 0 : 1)
  assert.ok(host.querySelector('table thead th button'), 'both layouts keep the real header controls')
  assert.equal(host.querySelectorAll('[data-list-layout-switch]').length, 0)
})

for (const related of [false, true]) test(`declared card fields render after the ${related ? 'related kayan title' : 'field-order title'}`, async () => {
  const { listOf } = await import('../registry/node-tree.ts')
  const node = { ...listOf(listScreen())!, columns: ['fee', 'title'].map((field) => ({ field })), card: ['fee'], ...(related && { of: 'sessions', where: 'course' }) }
  const host = await render(createElement(List, {
    kayan: { ...courses, useAsTitle: related ? 'title' : undefined, fields: [fieldOf({ name: 'title', kind: 'text' }), fieldOf({ name: 'fee', kind: 'number' })] },
    node, page: pageOf([{ id: 'c1', title: 'Tajweed', fee: 300 }]),
    query: {}, t: english, locale: 'en', onQuery: () => {}, href: (id: string) => `/courses/${id}`, newHref: '/courses/new',
  }))
  const row = host.querySelector('tr[data-row="c1"]')!
  assert.equal(row.querySelector('[data-list-title]')?.textContent?.includes('Tajweed'), true)
  const details = [...row.querySelectorAll('[data-list-detail]:not([data-list-extra])')]
  assert.equal(details.length, 1)
  assert.equal(details[0]!.querySelector('[data-list-label]')?.textContent, 'Fee:')
  assert.equal(details[0]!.querySelector('[data-list-value]')?.textContent?.includes('300'), true)
})

test('rich text fields expose only their selected formatting tools and counters never enter stored JSON', async () => {
  const { RichTextEditor } = await import('../registry/rich-text-editor.tsx')
  const changes: unknown[] = []
  const host = await render(createElement(RichTextEditor, { value: richOf(blockOf('paragraph', [textOf('مرحبا Hello')])), onChange: (value) => changes.push(value), direction: 'ltr', t, locale: 'ar-u-nu-latn', policy: { features: ['bold', 'counter'], fonts: ['sans'] } }))
  await act(async () => sleep(100))
  assert.ok(host.querySelector('button[aria-label="Bold"]'))
  assert.equal(host.querySelector('button[aria-label="Italic"]'), null)
  assert.equal(host.querySelector('button[aria-label="Add link"]'), null)
  assert.ok(host.querySelector('[data-rich-text-counter]')?.textContent?.includes('2'))
  assert.equal(JSON.stringify(changes).includes('characters'), false)
})

test('safe markdown shortcuts omit link transforms and follow field formatting choices', async () => {
  const { markdownTransformers } = await import('../registry/rich-text-markdown.tsx')
  const { LINK, BOLD_STAR, ITALIC_STAR } = await import('@lexical/markdown')
  const chosen = markdownTransformers({ features: ['bold', 'markdown'], fonts: ['sans'] })
  assert.ok(chosen.includes(BOLD_STAR))
  assert.equal(chosen.includes(ITALIC_STAR), false)
  assert.equal(chosen.includes(LINK), false)
})

test('block direction and fixed styling survive serialization without setting root direction or CSS', async () => {
  const { RichTextEditor, RichTextViewer } = await import('../registry/rich-text.tsx')
  const { $getRoot, $setState } = await import('lexical')
  const { directionChoice, colorChoice, sizeChoice, fontChoice } = await import('../registry/rich-text-choices.ts')
  const host = await render(createElement(RichTextEditor, { value: richOf(blockOf('paragraph', [textOf('مرحبا Hello')]), blockOf('paragraph', [textOf('English أولا')])), onChange: () => {}, direction: 'ltr', t, locale: 'en', policy: { features: ['direction', 'styling'], fonts: ['serif'] }, id: 'choices' }))
  await act(async () => sleep(100))
  const editor = (host.querySelector('#choices') as unknown as { __lexicalEditor: import('lexical').LexicalEditor }).__lexicalEditor
  await act(async () => editor.update(() => {
    const root = $getRoot()
    $setState(root.getFirstChild()!, directionChoice, 'rtl')
    const text = root.getAllTextNodes()[0]!
    $setState(text, colorChoice, 'primary')
    $setState(text, sizeChoice, 'large')
    $setState(text, fontChoice, 'serif')
  }))
  const saved = editor.getEditorState().toJSON()
  assert.equal(saved.root.direction, null)
  assert.equal((saved.root.children[0] as unknown as { $: { direction: string } }).$.direction, 'rtl')
  assert.equal(JSON.stringify(saved).includes('color:'), false)
  assert.equal(JSON.stringify(saved).includes('font-family:'), false)
  const viewer = await render(createElement(RichTextViewer, { value: saved, direction: 'ltr', t }))
  await act(async () => sleep(100))
  assert.equal(viewer.querySelector('p')?.getAttribute('dir'), 'rtl')
  assert.equal(viewer.querySelector('p span')?.getAttribute('style')?.includes('var(--primary)'), true)
})

test('a table can be inserted from its toolbar before the user focuses the editor', async () => {
  const { RichTextEditor } = await import('../registry/rich-text-editor.tsx')
  const host = await render(createElement(RichTextEditor, { value: null, onChange: () => {}, direction: 'ltr', t, locale: 'en', policy: { features: ['tables'], fonts: ['sans'] }, id: 'insert-table' }))
  await act(async () => sleep(100))
  await act(async () => click(buttonNamed(host, 'Table')!))
  const item = [...window.document.querySelectorAll('[role="menuitem"]')].find((one) => one.textContent === 'Insert table')
  assert.ok(item)
  await act(async () => click(item as unknown as Element))
  assert.equal(host.querySelectorAll('table').length, 1)
  assert.equal(host.querySelectorAll('table tr').length, 3)
})

test('whole-record delete uses solid destructive colours on its trigger and confirm', async () => {
  const { DeleteButton } = await import('../registry/delete-button.tsx')
  const host = await render(createElement(DeleteButton, { wholeRecord: true, busy: false, copy: { t, locale: 'en' }, kayan: courses, label: 'Delete course', onDelete: async () => true }))
  const trigger = host.querySelector('[data-button="delete"]')!
  assert.match(trigger.className, /bg-destructive(?:\s|$)/)
  assert.match(trigger.className, /text-white/)
  await act(async () => click(trigger))
  const confirm = window.document.querySelector('[data-slot="alert-dialog-action"]')!
  assert.match(confirm.className, /bg-destructive(?:\s|$)/)
  assert.match(confirm.className, /text-white/)
})

test('only whole-record destructive operations receive solid red, including their confirmation', async () => {
  const { FormButton } = await import('../registry/form-button.tsx')
  for (const fields of [undefined, [fieldOf({ name: 'reason', kind: 'text' })]]) {
    const operation = { name: 'archive', effect: 'update', label: { en: 'Archive' }, destructive: true, confirm: { title: { en: 'Archive?' }, body: { en: 'The record will be archived.' } }, fields }
    const host = await render(createElement(FormButton, { operation, kayan: courses, copy: { t, locale: 'en' }, busy: false, id: 'c1', run: async () => true, refuse: () => {}, onDelete: async () => true }))
    const trigger = host.querySelector('button')!
    assert.match(trigger.className, /bg-destructive(?:\s|$)/)
    await act(async () => click(trigger))
    assert.match(window.document.querySelector('[data-slot="alert-dialog-action"]')!.className, /bg-destructive(?:\s|$)/)
  }
  const { NodeButton } = await import('../registry/node-buttons.tsx')
  const ordinary = await render(createElement(NodeButton, { node: { label: { en: 'Archive' } }, copy: { t, locale: 'en' }, busy: false, run: () => {} }))
  assert.doesNotMatch(ordinary.querySelector('button')!.className, /bg-destructive(?:\s|$)/)
  const rows = await render(createElement(List, { kayan: courses, page: pageOf([{ id: 'c1', title: 'Tajweed' }]), query: {}, t, locale: 'en', onQuery: () => {}, href: (id: string) => `/courses/${id}`, newHref: '/courses/new', operations: { delete: true }, run: async () => ({}) }))
  await act(async () => click(rows.querySelector('[data-row="c1"] [data-slot="dropdown-menu-trigger"]')!))
  const remove = window.document.querySelector('[data-row-action="delete"]')!
  assert.ok(remove)
  assert.doesNotMatch(remove.className, /bg-destructive(?:\s|$)/)
  await act(async () => click(remove as unknown as Element))
  assert.doesNotMatch(window.document.querySelector('[data-slot="alert-dialog-action"]')!.className, /bg-destructive(?:\s|$)/)
})

test('choice forms seed required defaults, leave unseeded required choices empty, and keep Clear only for optional choices', async () => {
  for (const component of ['select', 'combobox']) {
    for (const rules of [{ required: true, defaultValue: 'SAR' }, { required: true }, { required: false }]) {
      const field = fieldOf({ name: 'currency', kind: 'text', component, rules, placeholder: { en: 'Choose currency' }, options: [{ value: 'SAR', label: { en: 'Riyal' } }, { value: 'USD', label: { en: 'Dollar' } }] })
      const kayan = { ...courses, fields: [field] }
      const host = await render(createElement(Form, { kayan, client: recording().client, value: null, t, locale: 'en', onDone: () => {} }))
      const input = host.querySelector('input[role="combobox"]') as HTMLInputElement | null
      const trigger = host.querySelector('[data-slot="select-trigger"]')
      assert.equal(input ? input.value : trigger?.textContent, rules.defaultValue ? 'Riyal' : component === 'select' ? 'Choose currency' : '')
      if (input) assert.equal(input.placeholder, 'Choose currency')
      await act(async () => click(input ?? trigger!))
      const items = [...window.document.querySelectorAll('[role="option"]')]
      assert.equal(items.some((one) => one.textContent === 'Clear'), component === 'select' && !rules.required)
      await act(async () => click(items.find((one) => one.textContent === 'Dollar')! as unknown as Element))
      if (component === 'combobox') {
        assert.equal(host.querySelector('[data-slot="combobox-clear"]') !== null, !rules.required)
      } else {
        await act(async () => click(trigger!))
        assert.equal([...window.document.querySelectorAll('[role="option"]')].some((one) => one.textContent === 'Clear'), !rules.required)
      }
    }
  }
})

test('relationship quick create uses its declared form, keeps refusals inside, then selects the new row', async () => {
  const name = fieldOf({ name: 'name', kind: 'text', rules: { required: true } })
  const hidden = fieldOf({ name: 'privateNote', kind: 'text', rules: { defaultValue: 'never send this' } })
  const target: ClientKayan = { ...screen.kayan.tags!, pages: { ...screen.kayan.tags!.pages, create: recordPage([{ form: ['name', 'details'] }], '/tags/new') }, fields: [name, hidden, fieldOf({ name: 'details', kind: 'text' })], quickCreate: { fields: [{ field: 'name' }, { field: 'privateNote', when: { name: { equals: 'secret' } } }] } }
  const made: Record<string, unknown>[] = []
  let refuse = true
  const host = await render(createElement(Form, { kayan: courses, screen: screenOf(recordPage([{ form: ['title', 'tags'] }])), client: recording().client, value: draftRow, t: (key: string, fallback?: string) => key === 'error.quickRefused' ? 'Not allowed here' : fallback, locale: 'en', onDone: () => {}, kayans: [courses, target], api: fakeApi({ tags: [] }).api }), {
    access: { collections: { tags: { operations: { create: true }, fields: { name: { create: true }, privateNote: { create: true }, details: { create: true } } } } },
    client: (async ({ input, operation, kayan }: { input: Record<string, unknown>; operation: string; kayan: string }) => {
      made.push({ input, operation, kayan })
      if (refuse) throw { data: { key: 'error.quickRefused' } }
      return { id: 'new-tag', ...input }
    }) as never,
  })
  await act(async () => click(host.querySelector('[data-add-new]')!))
  let drawer = documentDrawer()!
  assert.ok(drawer.querySelector('#tags-name'))
  assert.equal(drawer.querySelector('#tags-details'), null, 'quick form leaves full-create details out')
  assert.equal(drawer.querySelector('#tags-privateNote'), null, 'conditions hide the seeded note')
  await act(async () => typeInto(drawer.querySelector('#tags-name')!, 'New tag'))
  await act(async () => fire(drawer.querySelector('form')!, 'submit'))
  drawer = documentDrawer()!
  assert.ok(drawer, 'refusal keeps the drawer open')
  assert.match(drawer.querySelector('[role="alert"]')?.textContent ?? '', /Not allowed here/)
  refuse = false
  await act(async () => fire(drawer.querySelector('form')!, 'submit'))
  assert.deepEqual(made, [0, 1].map(() => ({ kayan: 'tags', operation: 'create', input: { name: 'New tag' } })))
  assert.equal(documentDrawer(), null)
  assert.match(host.querySelector('[data-control="relationship"]')!.textContent!, /New tag/)
})

test('a relationship field can opt out of create even when the actor may create its target', async () => {
  const kayan = { ...courses, fields: courses.fields.map((field) => field.name === 'tags' ? { ...field, allowCreate: false } : field) }
  const host = await render(createElement(Form, { kayan, screen: screenOf(recordPage([{ form: ['tags'] }]), kayan), client: recording().client, value: draftRow, t, locale: 'en', onDone: () => {}, kayans, api: fakeApi({ tags: [] }).api }), {
    access: { collections: { tags: { operations: { create: true }, fields: { name: { create: true } } } } },
  })
  assert.equal(host.querySelector('[data-add-new]') === null, true)
})

test('a relationship without quickCreate opens the complete create form', async () => {
  const target: ClientKayan = { ...screen.kayan.tags!, quickCreate: undefined, fields: [fieldOf({ name: 'name', kind: 'text' }), fieldOf({ name: 'details', kind: 'text' })], pages: { ...screen.kayan.tags!.pages, create: recordPage([{ form: ['name', 'details'] }], '/tags/new') } }
  const host = await render(createElement(Form, { kayan: courses, screen: screenOf(recordPage([{ form: ['tags'] }])), client: recording().client, value: draftRow, t, locale: 'en', onDone: () => {}, kayans: [courses, target], api: fakeApi({ tags: [] }).api }), { access: { collections: { tags: { operations: { create: true }, fields: { name: { create: true }, details: { create: true } } } } } })
  await act(async () => click(host.querySelector('[data-add-new]')!))
  assert.ok(documentDrawer()?.querySelector('#tags-name'))
  assert.ok(documentDrawer()?.querySelector('#tags-details'))
})

test('a form never sends a filled field after its parent condition hides it', async () => {
  const kayan = { ...courses, fields: [fieldOf({ name: 'notifications', kind: 'checkbox', rules: { defaultValue: true } }), fieldOf({ name: 'summary', kind: 'text', rules: { defaultValue: 'seed' } })] }
  const writes = recording()
  const host = await render(createElement(Form, { kayan, client: writes.client, value: null, screen: screenOf(recordPage([{ form: ['notifications', { section: 'notes', label: { en: 'Notes' }, when: { notifications: { equals: true } }, fields: ['summary'] }] }]), kayan), t, locale: 'en', onDone: () => {} }))
  await act(async () => typeInto(host.querySelector('#courses-summary')!, 'filled while visible'))
  await act(async () => click(host.querySelector('#courses-notifications')!))
  assert.equal(host.querySelector('#courses-summary') === null, true)
  await act(async () => fire(host.querySelector('form')!, 'submit'))
  assert.equal(writes.written.length, 1)
  assert.deepEqual(writes.written[0], { notifications: false })
})
