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

test('each organization mode\'s words replace keys the copy has, in both locales, and with one organization never shown no page of the app names an organization', async () => {
  const { scopes, withWording, wordingFor } = await import('./copy.ts')
  for (const showOrganization of [true, false]) {
    for (const [scope, keys] of Object.entries(wordingFor({ organizations: 'one', showOrganization }))) {
      for (const [key, words] of Object.entries(keys)) {
        assert.ok(scopes[scope]?.[key], `${showOrganization}: ${scope}.${key} is a key the copy has`)
        assert.ok(words.en && words.ar, `${showOrganization}: ${scope}.${key} carries both locales`)
      }
    }
  }
  // Read only where many organizations are: founding one, the switcher and its
  // switch, and the backoffice, whose staff work across organizations whatever the mode.
  const manyOnly = new Set(['auth.organization', 'auth.organizationFailed', 'auth.createOrganization', 'auth.switchTo', 'admin.organizations', 'admin.organization', 'admin.noOrganization'])
  const none = withWording(scopes, wordingFor({ organizations: 'one', showOrganization: false }))
  const named = Object.entries(none)
    .filter(([scope]) => ['auth', 'dashboard', 'marketing', 'admin', 'error'].includes(scope))
    .flatMap(([scope, keys]) => Object.entries(keys).map(([key, words]) => [`${scope}.${key}`, words] as const))
    .filter(([key, words]) => !manyOnly.has(key) && /organization|مؤسس/i.test(`${words.en} ${words.ar}`))
    .map(([key]) => key)
  assert.deepEqual(named, [], 'with the organization never shown, these still name one')
})

test('a retry conflict tells the caller to try again in both locales', async () => {
  const { translator } = await import('./copy.ts')
  assert.equal(translator('en')('error.conflict.retry'), 'Another write interrupted this transaction. Try again.')
  assert.equal(translator('ar')('error.conflict.retry'), 'تعارضت هذه المعاملة مع عملية أخرى. حاول مرة أخرى.')
})
