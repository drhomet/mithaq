// Measures the shipped date control in Chromium with each app's own Tailwind build and components: its day buttons are phone targets that fit the popover and a form card without sideways scrolling, and 32px from sm.
// Chromium is AUTH_BROWSER_EXECUTABLE or Playwright's own; a run without one skips, except in CI.
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { chromium, type Browser } from 'playwright-core'
import { createServer, type ViteDevServer } from 'vite'

const executablePath = process.env.AUTH_BROWSER_EXECUTABLE ?? chromium.executablePath()
const skip = !existsSync(executablePath)
assert.ok(!skip || process.env.CI === undefined, 'CI requires a Chromium for the date picker check')

// Both shells' phone page padding (`nav.tsx`, `app-shell.tsx`), around the form card the inline calendar is drawn in.
const fixture = `
import { createElement as h, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Card, CardContent } from '@/components/ui/card'
import { DirectionProvider } from '@/components/ui/direction'
import { CalendarControl, DatePicker } from 'mithaq-admin/date-control.tsx'
import '/src/styles.css'
const dir = new URLSearchParams(location.search).get('dir')
document.documentElement.dir = dir
document.documentElement.classList.toggle('dark', new URLSearchParams(location.search).get('theme') === 'dark')
function Controls() {
  const [values, setValues] = useState({})
  const props = (id) => ({ id, value: values[id] ?? '2026-09-15', values, setValue() {}, onChange(value) { setValues((previous) => ({ ...previous, [id]: value })) }, field: { name: id, kind: 'date', rules: {} }, kayan: { slug: 'events', fields: [] }, readOnly: false, locale: dir === 'rtl' ? 'ar' : 'en', t: (key, fallback) => fallback })
  return h(DirectionProvider, { direction: dir }, h('div', { className: 'flex flex-col px-4 pb-4 lg:px-6 lg:pb-6' },
    h(Card, null, h(CardContent, { className: 'flex flex-col gap-4' }, h(DatePicker, props('starts')), h('div', { id: 'inline' }, h(CalendarControl, props('day'))))),
    // From sm, a record page's side card can be narrower than the calendar.
    innerWidth >= 640 && h(Card, { className: 'mt-4 w-64' }, h(CardContent, null, h('div', { id: 'side' }, h(CalendarControl, props('side')))))))
}
createRoot(document.getElementById('root')).render(h(Controls))
`

const apps = ['asas-tanstack', 'asas-backoffice'] as const
let browser: Browser
const servers = new Map<string, ViteDevServer>()
before(async () => {
  if (skip) return
  browser = await chromium.launch({ executablePath, headless: true })
  for (const app of apps) servers.set(app, await serve(fileURLToPath(new URL(`../../${app}/`, import.meta.url))))
})
after(async () => {
  await browser?.close()
  for (const server of servers.values()) await server.close()
})

const serve = async (root: string) => {
  const server = await createServer({
    root, configFile: false, logLevel: 'error', server: { port: 0, host: '127.0.0.1' },
    resolve: { alias: [{ find: /^@\//, replacement: `${root}src/` }] },
    // Every dependency is found before the first request, since one found later reloads the page mid-test.
    optimizeDeps: { entries: ['src/components/ui/*.tsx', 'node_modules/mithaq-admin/registry/*.tsx'], include: ['react-dom/client'] },
    plugins: [tailwindcss(), {
      name: 'date-picker-fixture',
      resolveId: (id) => id === '/fixture.js' ? '\0fixture.js' : undefined,
      load: (id) => id === '\0fixture.js' ? fixture : undefined,
      configureServer: (vite) => void vite.middlewares.use((request, response, next) => request.url?.startsWith('/?')
        ? response.setHeader('content-type', 'text/html').end('<!doctype html><html><head><link rel="icon" href="data:,"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>')
        : next()),
    }],
  })
  return server.listen()
}

const sizes = (selector: string) => `[...document.querySelectorAll('${selector} button[data-day]')].map((one) => { const { width, height } = one.getBoundingClientRect(); return [width, height] })`
const overflow = 'document.documentElement.scrollWidth - document.documentElement.clientWidth'
// The card clips what crosses it, so each inline calendar must sit inside its card.
const spills = `[...document.querySelectorAll('[data-slot=card]')].some((card) => {
  const box = card.getBoundingClientRect(), calendar = card.querySelector('[data-slot=calendar]').getBoundingClientRect()
  return calendar.left < box.left - 0.5 || calendar.right > box.right + 0.5
})`
const outside = `(() => { const box = document.querySelector('[data-slot=popover-content]').getBoundingClientRect(); return box.left < 0 || box.right > innerWidth })()`
// Text ranges catch crowded glyphs even when the calendar and its cells still fit their container.
const weekdayBounds = `[...document.querySelectorAll('[data-slot=calendar]')].map((calendar) =>
  [...calendar.querySelectorAll('th[scope=col]')].map((cell) => {
    const range = document.createRange(); range.selectNodeContents(cell)
    const text = range.getBoundingClientRect(), box = cell.getBoundingClientRect()
    return { text: cell.textContent, label: cell.getAttribute('aria-label'), left: text.left, right: text.right, inset: Math.min(text.left - box.left, box.right - text.right) }
  }).sort((a, b) => a.left - b.left))`

// 360px is the narrow Android phone, 390px the common one.
for (const app of apps) for (const [width, phone] of [[360, true], [390, true], [768, false], [1024, false], [1440, false]] as const) {
  for (const dir of ['ltr', 'rtl'] as const) for (const theme of ['light', 'dark'] as const) test(`the ${app} date picker at ${width}px has spaced weekday headings and ${phone ? '44px day buttons that fit the card and popover' : '32px day buttons'} (${dir}, ${theme})`, { skip }, async () => {
    const page = await browser.newPage({ viewport: { width, height: 844 } })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
    try {
      await page.goto(`${servers.get(app)!.resolvedUrls!.local[0]}?dir=${dir}&theme=${theme}`)
      await page.locator('#inline button[data-day]').first().waitFor()
      await page.evaluate('document.fonts.ready')
      const fits = ([width, height]: number[]) => phone ? width! >= 44 && height! >= 44 : width === 32 && height === 32
      const inline = await page.evaluate(sizes('#inline')) as number[][]
      assert.ok(inline.length >= 28 && inline.every(fits), `inline ${JSON.stringify(inline[0])}`)
      assert.equal(await page.evaluate(spills), false, 'an inline calendar crosses its card')
      assert.equal(await page.evaluate(overflow), 0, 'the page scrolls sideways with the inline calendar')
      const shot = async (name: string) => {
        if (process.env.DATE_PICKER_SCREENSHOTS) {
          // Shot once the buttons' colour transitions to the theme have finished.
          await page.evaluate('Promise.all(document.getAnimations().map((one) => one.finished))')
          await page.screenshot({ path: `${process.env.DATE_PICKER_SCREENSHOTS}/${app}-${width}-${dir}-${name}-${theme}.png` })
        }
      }
      await shot('card')
      await page.locator('#starts').click()
      const popover = page.locator('[data-slot=popover-content]')
      await popover.locator('button[data-day]').first().waitFor()
      // Measured once the opening zoom has finished.
      await popover.evaluate((one) => Promise.all(one.getAnimations({ subtree: true }).map((animation) => animation.finished)))
      const days = await page.evaluate(sizes('[data-slot=popover-content]')) as number[][]
      assert.ok(days.length >= 28 && days.every(fits), `popover ${JSON.stringify(days[0])}`)
      assert.equal(await page.evaluate(outside), false, 'the popover leaves the screen')
      assert.equal(await page.evaluate(overflow), 0, 'the page scrolls sideways with the popover open')
      await shot('popover')
      const calendars = await page.evaluate(weekdayBounds) as { text: string; label: string; left: number; right: number; inset: number }[][]
      assert.equal(calendars.length, phone ? 2 : 3, 'popover, inline and side calendars are measured')
      for (const headings of calendars) {
        assert.equal(headings.length, 7)
        assert.equal(new Set(headings.map((one) => one.text)).size, 7, 'each weekday has a distinct heading')
        assert.ok(headings.every((one) => one.inset >= 2), `weekday text needs 2px on each side: ${JSON.stringify(headings)}`)
        assert.ok(headings.slice(1).every((one, index) => one.left - headings[index]!.right >= 4), 'weekday text needs 4px separation')
        const labels = dir === 'rtl' ? ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'] : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
        assert.deepEqual(headings.map((one) => one.label).sort(), [...labels].sort(), 'weekday headers keep full labels')
        if (dir === 'ltr') assert.deepEqual(headings.map((one) => one.text), ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'])
      }
      // DayPicker hides its header row, so full weekday names must remain on accessible day buttons.
      const accessibility = await popover.ariaSnapshot()
      assert.match(accessibility, dir === 'rtl' ? /button "الأربعاء، 16 سبتمبر 2026"/ : /button "Wednesday, September 16th, 2026"/)
      const selected = popover.locator('button[data-selected-single=true]')
      await selected.focus()
      await page.keyboard.press('ArrowDown')
      assert.equal(await popover.locator('button[data-day]:focus').textContent(), '22', 'keyboard moves a week')
      await page.keyboard.press('Enter')
      await popover.waitFor({ state: 'hidden' })
      await page.locator('#starts').click()
      assert.equal(await popover.locator('button[data-selected-single=true]').textContent(), '22', 'keyboard selection persists')
      await popover.locator('button[data-day]').filter({ hasText: /^23$/ }).click()
      await popover.waitFor({ state: 'hidden' })
      await page.locator('#starts').click()
      assert.equal(await popover.locator('button[data-selected-single=true]').textContent(), '23', 'pointer selection persists')
      assert.deepEqual(errors, [], 'no browser errors')
    } finally { await page.close() }
  })
}
