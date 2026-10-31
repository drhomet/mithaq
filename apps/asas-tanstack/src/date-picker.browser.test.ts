// Measures the shipped date control in Chromium with the tenant app's own Tailwind build: its day buttons are phone targets that fit the popover and a form card without sideways scrolling, and 32px from sm.
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

// The tenant shell's page padding (`nav.tsx`), around the form card the inline calendar is drawn in.
const fixture = `
import { createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { Card, CardContent } from '@/components/ui/card'
import { DirectionProvider } from '@/components/ui/direction'
import { CalendarControl, DatePicker } from 'mithaq-admin/date-control.tsx'
import '/src/styles.css'
const dir = new URLSearchParams(location.search).get('dir')
document.documentElement.dir = dir
const props = (id) => ({ id, value: '2026-09-15', values: {}, setValue() {}, onChange() {}, field: { name: id, kind: 'date', rules: {} }, kayan: { slug: 'events', fields: [] }, readOnly: false, locale: dir === 'rtl' ? 'ar' : 'en', t: (key, fallback) => fallback })
createRoot(document.getElementById('root')).render(h(DirectionProvider, { direction: dir }, h('div', { className: 'flex flex-col px-4 pb-4 lg:px-6 lg:pb-6' },
  h(Card, null, h(CardContent, { className: 'flex flex-col gap-4' }, h(DatePicker, props('starts')), h('div', { id: 'inline' }, h(CalendarControl, props('day'))))))))
`

const root = fileURLToPath(new URL('../', import.meta.url))
let browser: Browser
let server: ViteDevServer
before(async () => {
  if (skip) return
  browser = await chromium.launch({ executablePath, headless: true })
  server = await createServer({
    root, configFile: false, logLevel: 'error', server: { port: 0, host: '127.0.0.1' },
    resolve: { alias: [{ find: /^@\//, replacement: `${root}src/` }] },
    // Every dependency is found before the first request, since one found later reloads the page mid-test.
    optimizeDeps: { entries: ['src/components/ui/*.tsx', 'node_modules/mithaq-admin/registry/*.tsx'], include: ['react-dom/client'] },
    plugins: [tailwindcss(), {
      name: 'date-picker-fixture',
      resolveId: (id) => id === '/fixture.js' ? '\0fixture.js' : undefined,
      load: (id) => id === '\0fixture.js' ? fixture : undefined,
      configureServer: (vite) => void vite.middlewares.use((request, response, next) => request.url?.startsWith('/?')
        ? response.setHeader('content-type', 'text/html').end('<!doctype html><html><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>')
        : next()),
    }],
  })
  await server.listen()
})
after(async () => {
  await browser?.close()
  await server?.close()
})

const sizes = (selector: string) => `[...document.querySelectorAll('${selector} button[data-day]')].map((one) => { const { width, height } = one.getBoundingClientRect(); return [width, height] })`
const overflow = 'document.documentElement.scrollWidth - document.documentElement.clientWidth'
// The card clips what crosses it, so the inline calendar must sit inside the card's padding.
const spills = `(() => {
  const content = document.querySelector('[data-slot=card-content]'), style = getComputedStyle(content), box = content.getBoundingClientRect()
  const calendar = document.querySelector('#inline [data-slot=calendar]').getBoundingClientRect()
  return calendar.left < box.left + parseFloat(style.paddingLeft) - 0.5 || calendar.right > box.right - parseFloat(style.paddingRight) + 0.5
})()`
const outside = `(() => { const box = document.querySelector('[data-slot=popover-content]').getBoundingClientRect(); return box.left < 0 || box.right > innerWidth })()`

for (const [width, phone] of [[390, true], [1024, false]] as const) {
  for (const dir of ['ltr', 'rtl'] as const) test(`the tenant date picker at ${width}px has ${phone ? '44px day buttons that fit the card and popover' : '32px day buttons'} (${dir})`, { skip }, async () => {
    const page = await browser.newPage({ viewport: { width, height: 844 } })
    try {
      await page.goto(`${server.resolvedUrls!.local[0]}?dir=${dir}`)
      await page.locator('#inline button[data-day]').first().waitFor()
      const fits = ([width, height]: number[]) => phone ? width! >= 44 && height! >= 44 : width === 32 && height === 32
      const inline = await page.evaluate(sizes('#inline')) as number[][]
      assert.ok(inline.length >= 28 && inline.every(fits), `inline ${JSON.stringify(inline[0])}`)
      assert.equal(await page.evaluate(spills), false, 'the inline calendar crosses the card padding')
      assert.equal(await page.evaluate(overflow), 0, 'the page scrolls sideways with the inline calendar')
      const shot = async (name: string) => process.env.DATE_PICKER_SCREENSHOTS && await page.screenshot({ path: `${process.env.DATE_PICKER_SCREENSHOTS}/${width}-${dir}-${name}.png` })
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
    } finally { await page.close() }
  })
}
