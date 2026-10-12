import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mergedHeaders } from './request-headers.ts'

test("a page's own request headers are merged over the session's, its cookie always the session's", () => {
  const session = new Headers({ cookie: 'session=abc', 'x-forwarded-for': '1.2.3.4' })

  assert.deepEqual([...mergedHeaders(session)].sort(), [['cookie', 'session=abc'], ['x-forwarded-for', '1.2.3.4']])

  // A plain `{ ...init, headers: request.headers }` would drop the POST's own `content-type`.
  const withContentType = mergedHeaders(session, { 'content-type': 'application/json' })
  assert.equal(withContentType.get('content-type'), 'application/json', "the loader's own header is kept")
  assert.equal(withContentType.get('cookie'), 'session=abc', 'and the session headers ride along with it')
  assert.equal(withContentType.get('x-forwarded-for'), '1.2.3.4', 'every session header, not only the cookie')

  // A loader's own headers cannot act as another actor: the session's cookie always wins.
  assert.equal(mergedHeaders(session, { cookie: 'session=forged' }).get('cookie'), 'session=abc', "the session's cookie is kept whatever the loader sets")
})
