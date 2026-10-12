import assert from 'node:assert/strict'
import { test } from 'node:test'
import { screenNamed } from './screen-names.ts'

// A server function's input is whatever a request sent, so the screen name is refused
// unless it is a folder this app globbed, before anything reads `asas.targets` by it.
test('a screen name is one of the known screens, and nothing a prototype answers', () => {
  const known = { dashboard: {}, portal: {} }
  assert.equal(screenNamed(known, 'dashboard'), 'dashboard')
  for (const asked of ['drizzle', 'service', '__proto__', 'toString', 'constructor', '', 42, null, undefined]) {
    assert.throws(() => screenNamed(known, asked), /is no screen of this app/, String(asked))
  }
})
