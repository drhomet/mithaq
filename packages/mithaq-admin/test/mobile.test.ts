import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { act, createElement } from 'react'
import './dom.ts'
import './tsx.ts'
import { mount, window } from './dom.ts'

const { createRoot } = await import('react-dom/client')
const select = await import('../registry/ui/select.tsx')
const combobox = await import('../registry/ui/combobox.tsx')
const menu = await import('../registry/ui/dropdown-menu.tsx')

const mounted = async (element: import('react').ReactElement) => {
  const host = mount()
  const root = createRoot(host)
  await act(async () => root.render(element))
  return async () => { await act(async () => root.unmount()); host.remove() }
}

test('a short Arabic select value aligns to the reading start', async () => {
  const close = await mounted(createElement(select.Select, { value: 'short' },
    createElement(select.SelectTrigger, { dir: 'rtl' }, createElement(select.SelectValue, {}, 'قصير'))))
  try {
    const value = window.document.querySelector('[data-slot=select-value]')!
    assert.ok(value.classList.contains('text-start'))
    assert.ok(!value.classList.contains('text-left'))
  } finally { await close() }
})

for (const kind of ['select', 'combobox', 'dropdown'] as const) test(`a bare ${kind} option owns its phone target and desktop reset`, async () => {
  const element = kind === 'select'
    ? createElement(select.Select, { open: true, value: 'one' }, createElement(select.SelectTrigger, {}, createElement(select.SelectValue, {}, 'One')), createElement(select.SelectContent, {}, createElement(select.SelectItem, { value: 'one' }, 'One')))
    : kind === 'combobox'
      ? createElement(combobox.Combobox, { open: true, items: ['One'] }, createElement(combobox.ComboboxInput, { triggerLabel: 'Open' }), createElement(combobox.ComboboxContent, {}, createElement(combobox.ComboboxList, {}, createElement(combobox.ComboboxItem, { value: 'One' }, 'One'))))
      : createElement(menu.DropdownMenu, { open: true }, createElement(menu.DropdownMenuTrigger, {}, 'Open'), createElement(menu.DropdownMenuContent, {}, createElement(menu.DropdownMenuItem, {}, 'One')))
  const close = await mounted(element)
  try {
    const item = window.document.querySelector(`[data-slot=${kind === 'dropdown' ? 'dropdown-menu' : kind}-item]`)!
    assert.ok(item)
    assert.ok(item.classList.contains('min-h-11'))
    assert.ok(item.classList.contains('sm:min-h-0'))
  } finally { await close() }
})

test('converted screen directories contain no desktop-first breakpoint overrides', () => {
  const root = new URL('../../../', import.meta.url)
  const directories = ['packages/mithaq-admin/registry/', 'templates/mithaq/src/ui/', 'templates/asas/src/ui-backoffice/', 'templates/asas/src/ui-dashboard/', 'templates/asas/src/ui-portal/', 'templates/features/', 'apps/asas-tanstack/src/', 'apps/asas-backoffice/src/']
  const failures: string[] = []
  const paths = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', ...directories], { cwd: fileURLToPath(root), encoding: 'utf8' }).split('\0').filter(Boolean)
  for (const path of paths) {
    if (!/\.(tsx?|css)$/.test(path)) continue
    const source = readFileSync(new URL(path, root), 'utf8')
    if (/max-(sm|md|lg|xl):/.test(source)) failures.push(path)
  }
  assert.deepEqual(failures, [])
})

test('a bare select trigger and combobox input own phone targets', async () => {
  const closeSelect = await mounted(createElement(select.Select, { value: 'one' }, createElement(select.SelectTrigger, {}, createElement(select.SelectValue, {}, 'One'))))
  try { assert.ok(window.document.querySelector('[data-slot=select-trigger]')!.classList.contains('min-h-11')) } finally { await closeSelect() }
  const closeCombo = await mounted(createElement(combobox.Combobox, { items: ['One'] }, createElement(combobox.ComboboxInput, { triggerLabel: 'Options' })))
  try {
    for (const selector of ['[data-slot=input-group]', '[data-slot=input-group-control]', '[data-slot=input-group-button]']) assert.ok(window.document.querySelector(selector)!.classList.contains('min-h-11'), selector)
  } finally { await closeCombo() }
})

// The tenant app is the phone-first shell; the backoffice keeps the shadcn size on every width, as its own buttons keep their look.
const cellSize = (classes: string[]) => ({
  base: classes.find((one) => one.startsWith('[--cell-size:')),
  desktop: classes.find((one) => one.startsWith('sm:[--cell-size:')),
})

for (const [app, phone] of [['asas-tanstack', true], ['asas-backoffice', false]] as const) {
  for (const dir of ['ltr', 'rtl'] as const) test(`the ${app} date picker's day buttons ${phone ? 'start at the 44px phone target and return to 32px from sm' : 'stay 32px'} (${dir})`, async () => {
    const { Calendar } = await import(`../../../apps/${app}/src/components/ui/calendar.tsx`)
    const { DirectionProvider } = await import('../registry/ui/direction.tsx')
    const close = await mounted(createElement(DirectionProvider, { direction: dir }, createElement(Calendar, { mode: 'single', defaultMonth: new Date(2026, 8, 1), dir })))
    try {
      const calendar = window.document.querySelector('[data-slot=calendar]')!
      const { base, desktop } = cellSize([...calendar.classList])
      assert.equal(base, phone ? '[--cell-size:--spacing(11)]' : '[--cell-size:--spacing(8)]')
      assert.equal(desktop, phone ? 'sm:[--cell-size:--spacing(8)]' : undefined)
      // The day button's width floor is the cell size, so the variable is the day button's size.
      assert.ok(calendar.querySelector('[data-day] button')!.classList.contains('min-w-(--cell-size)'))
    } finally { await close() }
  })
}
