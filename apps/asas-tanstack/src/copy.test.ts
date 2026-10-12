import assert from 'node:assert/strict'
import { mock, test } from 'node:test'
import { window } from '../../../packages/mithaq-admin/test/dom.ts'
import { switchLocale } from './copy.ts'

test('switching the language writes the cookie, drops the form\'s unload guard so the browser does not ask a second time, and reloads', () => {
  const reload = mock.method(window.location, 'reload', () => {})
  try {
    window.document.cookie = 'locale=en; Path=/'
    window.onbeforeunload = () => ''
    switchLocale({ to: 'ar' })
    assert.equal(reload.mock.callCount(), 1, 'it reloads')
    assert.match(window.document.cookie, /locale=ar/, 'in the chosen language')
    assert.equal(window.onbeforeunload, null, 'without the browser asking a second time')
  } finally {
    reload.mock.restore()
    window.onbeforeunload = null
  }
})
