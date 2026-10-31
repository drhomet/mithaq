// Measures an upload kayan's built-in pieces in Chromium with the tenant app's own Tailwind build: on a phone the file
// beside its edit form and the New page offer 44px targets and never scroll sideways, in either direction.
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
assert.ok(!skip || process.env.CI === undefined, 'CI requires a Chromium for the upload pages check')

// A kayan of another name than the template's, inside the tenant shell's page padding (`nav.tsx`).
const fixture = `
import { createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { ScreenContext } from 'mithaq/admin/react'
import { DirectionProvider } from '@/components/ui/direction'
import { ComponentsProvider } from 'mithaq-admin/components.tsx'
import { FileCell, FileDetails, NewUpload } from 'mithaq-admin/upload-pages.tsx'
import { components } from '@/components.ts'
import { translator } from '@/copy.ts'
import '/src/styles.css'
const query = new URLSearchParams(location.search)
const dir = query.get('dir'), locale = dir === 'rtl' ? 'ar' : 'en'
document.documentElement.dir = dir
document.documentElement.classList.toggle('dark', query.get('theme') === 'dark')
const png = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="#6b8"/></svg>')
const record = { id: 'f1', filename: 'a-rather-long-file-name-for-the-cover-of-the-course.png', mimeType: 'image/png', filesize: 245760, url: png, thumbnailURL: png }
const kayan = { name: 'files', fields: [{ name: 'alt', kind: 'text', rules: { required: true, localized: true } }], operations: [], pages: { list: { path: '/files' }, edit: { path: '/files/:id' } }, storage: { mimeTypes: ['image/png'], fileSize: 10485760 } }
const state = { t: translator(locale), locale, dir, screen: { path: '/dashboard', kayan: { files: kayan } }, access: { collections: { files: { create: true, operations: { create: true }, fields: { alt: { create: true } } } } }, user: { name: 'A', email: 'a@example.com' }, client: async () => ({}), kayan, record }
const pdf = { id: 'f2', filename: 'the-rather-long-terms-and-conditions-of-enrollment-for-the-year.pdf', mimeType: 'application/pdf', url: '/api/files/file/f2', thumbnailURL: null }
const view = query.get('view')
const cell = (row) => h(FileCell, { field: { name: 'filename', kind: 'text', rules: {} }, value: row.filename, row })
const drawn = view === 'details' ? h(FileDetails, { locales: ['ar', 'en'] }) : view === 'new' ? h(NewUpload, { locales: ['ar', 'en'] }) : view === 'pdf' ? cell(pdf) : cell(record)
createRoot(document.getElementById('root')).render(h(DirectionProvider, { direction: dir }, h(ScreenContext, { value: state }, h(ComponentsProvider, { components },
  h('div', { className: 'flex flex-col px-4 pb-4 pt-4 lg:px-6 lg:pb-6' }, drawn)))))
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
      name: 'upload-pages-fixture',
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

const heights = (selector: string) => `[...document.querySelectorAll('${selector}')].map((one) => one.getBoundingClientRect().height)`
const overflow = 'document.documentElement.scrollWidth - document.documentElement.clientWidth'

for (const width of [360, 390] as const) {
  for (const dir of ['ltr', 'rtl'] as const) test(`an upload kayan's file details and New page at ${width}px have 44px targets and no sideways scroll (${dir})`, { skip }, async () => {
    const page = await browser.newPage({ viewport: { width, height: 844 } })
    const errors: string[] = []
    page.on('pageerror', (error) => void errors.push(error.message))
    try {
      const shot = async (name: string) => process.env.UPLOAD_PAGES_SCREENSHOTS && await page.screenshot({ path: `${process.env.UPLOAD_PAGES_SCREENSHOTS}/${width}-${dir}-${name}.png`, fullPage: true })
      for (const theme of ['light', 'dark']) {
        await page.goto(`${server.resolvedUrls!.local[0]}?view=details&dir=${dir}&theme=${theme}`)
        await page.locator('[data-file-replace]').waitFor()
        const buttons = await page.evaluate(heights('[data-file-download], [data-file-replace]')) as number[]
        assert.ok(buttons.length === 2 && buttons.every((one) => one >= 44), `details ${JSON.stringify(buttons)}`)
        assert.equal(await page.evaluate(overflow), 0, 'the details scroll sideways')
        await shot(`details-${theme}`)
        await page.goto(`${server.resolvedUrls!.local[0]}?view=cell&dir=${dir}&theme=${theme}`)
        await page.locator('[data-upload-thumbnail]').waitFor()
        assert.equal(await page.evaluate(overflow), 0, 'the cell scrolls sideways')
        await shot(`cell-${theme}`)
        await page.goto(`${server.resolvedUrls!.local[0]}?view=pdf&dir=${dir}&theme=${theme}`)
        const name = page.locator('[title$=".pdf"]')
        await name.waitFor()
        // A name too long for one line wraps onto a second rather than being cut, as an image's does.
        assert.ok((await name.evaluate((one) => one.getBoundingClientRect().height / parseFloat(getComputedStyle(one).lineHeight))) > 1.5, 'the file name is cut to one line')
        assert.equal(await page.evaluate(overflow), 0, 'a file that is no image scrolls sideways')
        await shot(`pdf-${theme}`)
        await page.goto(`${server.resolvedUrls!.local[0]}?view=new&dir=${dir}&theme=${theme}`)
        await page.locator('[data-upload-dialog="files"]').waitFor()
        await page.locator('[data-upload-dialog]').evaluate((one) => Promise.all(one.getAnimations({ subtree: true }).map((animation) => animation.finished)))
        assert.equal(await page.evaluate(overflow), 0, 'the New page scrolls sideways with its dialog open')
        await shot(`new-${theme}`)
        // Measured under the open dialog: closing it leaves for the list.
        const again = await page.evaluate(heights('[data-upload-new-page] button')) as number[]
        assert.ok(again.length === 1 && again[0]! >= 44, `New ${JSON.stringify(again)}`)
      }
      assert.deepEqual(errors, [])
    } finally { await page.close() }
  })
}
