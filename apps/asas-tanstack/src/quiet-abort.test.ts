import assert from 'node:assert/strict'
import { test } from 'node:test'
import { withQuietAbort } from './quiet-abort.ts'

test('a request handed to TanStack Start aborts when its client does, with a reason h3 takes as its own handled error, and carries the same URL, method, headers and body', async () => {
  const client = new AbortController()
  const asked = new Request('http://test/api/courses/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"title":"Kept"}', signal: client.signal })
  const handed = withQuietAbort(asked)
  assert.equal(handed.url, asked.url)
  assert.equal(handed.method, 'POST')
  assert.equal(handed.headers.get('content-type'), 'application/json')
  assert.equal(await handed.text(), '{"title":"Kept"}')
  assert.equal(handed.signal.aborted, false, 'not aborted while the client is there')
  client.abort()
  assert.equal(handed.signal.aborted, true, 'aborted once the client is gone')
  const reason = handed.signal.reason as Error & { status: number; toJSON: () => unknown }
  assert.equal(reason instanceof Error && reason.name === 'HTTPError', true, 'a reason h3 reads as its own error, which it does not log as unhandled')
  assert.equal(reason.status, 499)
  assert.deepEqual(reason.toJSON(), { status: 499, message: 'The client closed the request.' })

  const gone = new AbortController()
  gone.abort()
  assert.equal(withQuietAbort(new Request('http://test/', { signal: gone.signal })).signal.aborted, true, 'a client already gone is gone on the request handed on')
})
