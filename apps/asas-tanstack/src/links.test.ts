import assert from 'node:assert/strict'
import { test } from 'node:test'
import { window } from '../../../packages/mithaq-admin/test/dom.ts'
import { clampedHref, routedHref } from './links.ts'

test('a plain click on a link inside the screen is routed, and every click the browser should keep is left to it', () => {
  const origin = 'http://127.0.0.1'
  // `routedHref` reads `anchor.href`, so the page must agree with the origin this test passes.
  window.happyDOM.setURL(`${origin}/dashboard`)
  const link = (href: string, attributes: Record<string, string> = {}) => {
    const anchor = window.document.createElement('a')
    anchor.setAttribute('href', href)
    for (const [name, value] of Object.entries(attributes)) anchor.setAttribute(name, value)
    const inner = window.document.createElement('span')
    anchor.append(inner)
    window.document.body.append(anchor)
    return inner as unknown as Element
  }
  const click = (target: Element, over: Partial<MouseEvent> = {}) =>
    routedHref({
      event: { button: 0, metaKey: false, altKey: false, ctrlKey: false, shiftKey: false, defaultPrevented: false, target, ...over },
      origin,
      base: '/dashboard',
    })

  assert.equal(click(link('/dashboard/courses?where[title][like]=a#top')), '/dashboard/courses?where[title][like]=a#top', 'a link inside the screen, reached from a child of the anchor')
  assert.equal(click(link('/dashboard')), '/dashboard', 'and the screen\'s own root')
  assert.equal(click(link('/dashboard', { target: '_self' })), '/dashboard', 'and a link that names this window')
  for (const [why, over] of [
    ['a click already handled', { defaultPrevented: true }],
    ['a middle click', { button: 1 }],
    ['a click opening a new tab', { metaKey: true }],
    ['a click opening a new window', { shiftKey: true }],
    ['a control click', { ctrlKey: true }],
    ['an alt click, which downloads', { altKey: true }],
  ] as const) {
    assert.equal(click(link('/dashboard/courses'), over), undefined, why)
  }
  assert.equal(click(link('/dashboard/courses', { target: '_blank' })), undefined, 'a link to another window')
  assert.equal(click(link('/dashboard/courses', { download: '' })), undefined, 'a download')
  assert.equal(click(link('/dashboards')), undefined, 'a path that only starts with the screen\'s')
  assert.equal(click(link('/portal/courses')), undefined, 'another screen, which has its own frame')
  assert.equal(click(link('/auth/sign-in')), undefined, 'a page outside every screen')
  assert.equal(click(link('https://example.com/dashboard')), undefined, 'another origin')
  assert.equal(click(window.document.body as unknown as Element), undefined, 'a click on no link')
})

// A bare relative href resolves against the current page, as `anchor.href` does; `new
// URL(href, origin)` would resolve `edit` on `/dashboard/courses/` to `/edit`.
test('a relative href resolves against the current page, not the origin', () => {
  const origin = 'http://127.0.0.1'
  const target = (href: string) => {
    const anchor = window.document.createElement('a')
    anchor.setAttribute('href', href)
    window.document.body.append(anchor)
    return anchor as unknown as Element
  }
  const click = (target: Element) =>
    routedHref({
      event: { button: 0, metaKey: false, altKey: false, ctrlKey: false, shiftKey: false, defaultPrevented: false, target },
      origin,
      base: '/dashboard',
    })

  window.happyDOM.setURL(`${origin}/dashboard/courses/`)
  assert.equal(click(target('edit')), '/dashboard/courses/edit', 'a bare relative href resolves against the page it is on')

  window.happyDOM.setURL(`${origin}/dashboard/courses`)
  assert.equal(click(target('?page=2')), '/dashboard/courses?page=2', 'a query-only href keeps the current path')
})

test('a list asked for a page past its last is sent to its last, every other key of the URL kept, and a page in range is left alone', () => {
  assert.equal(clampedHref({ href: '/dashboard/courses?page=999&sort=-title', page: 999, totalPages: 3 }), '/dashboard/courses?page=3&sort=-title')
  assert.equal(clampedHref({ href: '/dashboard/courses?search=x&page=2', page: 2, totalPages: 1 }), '/dashboard/courses?search=x', 'the last page is the first, which the URL writes as no page')
  assert.equal(clampedHref({ href: '/dashboard/courses?page=999', page: 999, totalPages: 1 }), '/dashboard/courses')
  assert.equal(clampedHref({ href: '/dashboard/courses?page=2', page: 2, totalPages: 3 }), undefined)
  assert.equal(clampedHref({ href: '/dashboard/courses', page: 1, totalPages: 1 }), undefined)
  assert.equal(clampedHref({ href: '/dashboard/courses', page: 1, totalPages: 0 }), undefined, 'a store that answers no pages at all does not send page one to itself again')
})
