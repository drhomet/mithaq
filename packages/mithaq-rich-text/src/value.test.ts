import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { isRichText, richTextBounds, richTextGuard, safeUrl } from './value.ts'

const paragraph = (text: string, extra: object = {}) => ({ type: 'paragraph', version: 1, children: [{ type: 'text', version: 1, text, format: 0, detail: 0, mode: 'normal', style: '', ...extra }] })
const value = (...children: object[]) => ({ root: { type: 'root', version: 1, children } })
const link = (url: string) => value({ type: 'paragraph', version: 1, children: [{ type: 'link', version: 1, url, children: [{ type: 'text', version: 1, text: 'x' }] }] })

const URLS: [string, boolean][] = [
  ['https://example.com/a?b#c', true], ['http://example.com', true], ['HTTPS://Example.com', true], ['https://user:pass@example.com:8080/x', true],
  ['https://[::1]/x', true], ['https://مثال.اختبار/', true], ['https://xn--mgbh0fb.xn--kgbechtv', true], ['https://127.0.0.1:3000', true],
  ['mailto:a@example.com', true], ['tel:+966500000000', true], ['/path', true], ['#top', true], ['./a', true], ['../a', true],
  ['https://', false], ['http:///path', false], ['https://@', false], ['https://[]', false], ['https://:80', false], ['https://user@', false],
  ['https://.', false], ['https://-', false], ['javascript:alert(1)', false], ['data:text/html,x', false], ['ftp://example.com', false],
  ['https:\\\\example.com', false], ['https://exa mple.com', false], ['', false], [' ', false], ['https:example.com', false],
  ['https://a<b.com', false], ['https://a^b.com', false], ['https://a|b.com', false], ['https://a%b.com', false], ['https://a:b', false],
  ['https://example.com:65535', true], ['https://example.com:65536', false], ['https://example.com:', true], ['https://[::1', false],
  ['https://u@v@example.com', true], ['https://example.com\\path', true], ['https://a\\b', true],
  ['https://a\u2028b', false], ['https://a\u2029b', false], ['https://a＠b', false], ['https://a／b', false], ['https://a：b', false], ['https://™', true],
]

test('safeUrl answers as before for web addresses, mail, phone, paths and fragments', () => {
  for (const [url, safe] of URLS) assert.equal(safeUrl(url), safe, url)
})

test('the byte bound counts UTF-8 bytes as TextEncoder does', () => {
  const near = (text: string) => value(paragraph(text))
  const size = (text: string) => new TextEncoder().encode(JSON.stringify(near(text))).length
  for (const unit of ['a', 'ع', '😀', '\ud800']) {
    const base = size('')
    const count = Math.floor((richTextBounds.bytes - base) / new TextEncoder().encode(JSON.stringify(unit).slice(1, -1)).length)
    const fits = unit.repeat(count)
    assert.ok(size(fits) <= richTextBounds.bytes, unit)
    assert.equal(richTextGuard(near(fits)), undefined, `${unit} fits`)
    assert.match(richTextGuard(near(fits + unit.repeat(2))) ?? '', /larger than/, `${unit} past the bound`)
  }
})

test('the guards run without TextEncoder, Object.hasOwn or URL, as on Lynx', () => {
  const saved = { TextEncoder: globalThis.TextEncoder, URL: globalThis.URL, hasOwn: Object.hasOwn }
  try {
    delete (globalThis as { TextEncoder?: unknown }).TextEncoder
    delete (globalThis as { URL?: unknown }).URL
    delete (Object as { hasOwn?: unknown }).hasOwn
    assert.ok(isRichText(value(paragraph('نص · text'), { type: 'horizontalrule', version: 1 })))
    assert.ok(isRichText(link('https://example.com')))
    assert.ok(!isRichText(link('https://@')))
    assert.ok(!isRichText(link('javascript:alert(1)')))
    assert.ok(!isRichText(value(paragraph('x', { style: 'color: red' }))))
    assert.ok(!isRichText(value(paragraph('x', { format: 1.5 }))))
    assert.match(richTextGuard(value(paragraph('a'.repeat(richTextBounds.bytes)))) ?? '', /larger than/)
    for (const [url, safe] of URLS) assert.equal(safeUrl(url), safe, url)
  } finally {
    Object.assign(globalThis, { TextEncoder: saved.TextEncoder, URL: saved.URL })
    Object.hasOwn = saved.hasOwn
  }
})

test('no source file of the package needs TextEncoder, Object.hasOwn or WHATWG URL, which Lynx lacks', () => {
  const folder = new URL('./', import.meta.url)
  for (const name of readdirSync(folder).filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))) {
    const source = readFileSync(new URL(name, folder), 'utf8')
    assert.doesNotMatch(source, /new TextEncoder|Object\.hasOwn\(|new URL\(/, name)
  }
})
