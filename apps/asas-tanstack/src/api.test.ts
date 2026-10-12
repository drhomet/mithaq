import assert from 'node:assert/strict'
import { test } from 'node:test'
import { afterCommitHeader } from 'mithaq/admin'
import { arm, authArm } from './api.ts'
import { translator } from './copy.ts'

test('a screen\'s calls use the plain fetch operation arm', async () => {
  const previous = globalThis.fetch
  const calls: { url: string; body: unknown }[] = []
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)) })
    return Response.json({ docs: [], hasNextPage: false, nextPage: null })
  }
  try {
    await arm.courses!.find!({ limit: 2 })
    assert.deepEqual(calls, [{ url: '/api/courses/find', body: { limit: 2 } }])
  } finally {
    globalThis.fetch = previous
  }
})

test('the fetch arm preserves a refusal status and copy key', async () => {
  const previous = globalThis.fetch
  globalThis.fetch = async () => Response.json({ code: 'FORBIDDEN', data: { key: 'error.forbidden.read', params: { kayan: 'courses' } }, message: 'Forbidden' }, { status: 403 })
  try {
    await assert.rejects(() => arm.courses!.find!({}), (error: unknown) => {
      const held = error as { status?: number; data?: { key?: string; params?: { kayan?: string } } }
      assert.equal(held.status, 403)
      assert.deepEqual(held.data, { key: 'error.forbidden.read', params: { kayan: 'courses' } })
      return true
    })
  } finally {
    globalThis.fetch = previous
  }
})

test('a screen treats an afterCommit warning as a saved write, raises the banner, and only a write the server says committed clears it', async () => {
  const originalFetch = globalThis.fetch
  const originalWindow = globalThis.window
  const events = new EventTarget()
  const seen: boolean[] = []
  // Only the server knows an operation's effect, so the fetch plug answers `failed` or `ok`
  // on a write and nothing on a read, custom ones included.
  let said: 'ok' | 'failed' | undefined = 'failed'
  events.addEventListener('mithaq:after-commit', (event) => { seen.push((event as CustomEvent<boolean>).detail) })
  Object.assign(globalThis, {
    window: events,
    fetch: async () => Response.json({ id: 7, title: 'Saved' }, { headers: said ? { [afterCommitHeader]: said } : {} }),
  })
  try {
    assert.deepEqual(await arm.notes!.create!({ title: 'Saved' }), { id: 7, title: 'Saved' })
    said = undefined
    for (const read of ['find', 'findByID', 'count', 'findOne', 'report', 'uploadInstructions']) await arm.notes![read]!({})
    assert.deepEqual(seen, [true], 'a read, custom or not, neither raises nor clears it')
    for (const operation of ['update', 'delete', 'updateMany', 'deleteMany', 'archive']) {
      said = 'failed'
      await arm.notes![operation]!({ id: 7 })
      said = 'ok'
      await arm.notes![operation]!({ id: 7 })
    }
    assert.deepEqual(seen, [true, ...Array(5).fill([true, false]).flat()], 'every write that did not fail clears it')
    assert.match(translator('en')('admin.afterCommitFailed') ?? '', /saved/i)
    assert.match(translator('ar')('admin.afterCommitFailed') ?? '', /حفظ/)
  } finally {
    Object.assign(globalThis, { fetch: originalFetch, window: originalWindow })
  }
})

test('a draft save and an autosave carry their words on the query string, as Payload\'s REST reads them, and a plain call carries none', async () => {
  const previous = globalThis.fetch
  const urls: string[] = []
  globalThis.fetch = async (input) => {
    urls.push(String(input))
    return Response.json({ id: 'a' })
  }
  try {
    await arm.courses!.update!({ id: 'a' }, { draft: true })
    await arm.courses!.update!({ id: 'a' }, { draft: true, autosave: true })
    await arm.courses!.create!({ title: 'a' }, {})
    assert.deepEqual(urls, ['/api/courses/update?draft=true', '/api/courses/update?draft=true&autosave=true', '/api/courses/create'])
  } finally {
    globalThis.fetch = previous
  }
})

test('a failed auth request answers a refusal with no status rather than throwing, so the button that sent it comes back', async () => {
  const previous = globalThis.fetch
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch')
  }
  try {
    assert.deepEqual(await authArm('sign-in/email', {}), { ok: false, status: 0, message: undefined, body: null })
  } finally {
    globalThis.fetch = previous
  }
})
