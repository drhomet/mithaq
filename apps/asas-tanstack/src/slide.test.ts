import assert from 'node:assert/strict'
import { test } from 'node:test'
import { slide } from './slide.ts'

// Two Better Auth kayan each refresh their own session, and the response header is set by
// name, so a second set would replace the first.
test('every strategy\'s refreshed cookie reaches the response, set once', async () => {
  const strategy = (cookie: string) => ({
    server: { api: { getSession: async () => ({ headers: new Headers([['set-cookie', cookie]]) }) } },
  })
  const response = new Headers()
  let sets = 0
  await slide({
    strategies: [strategy('a=1; Path=/'), { name: 'local' }, strategy('b=2; Path=/')],
    headers: new Headers(),
    setResponseHeader: (name, value) => {
    sets += 1
    response.delete(name)
    for (const one of value) response.append(name, one)
  },
  })
  assert.deepEqual(response.getSetCookie(), ['a=1; Path=/', 'b=2; Path=/'], 'both strategies\' cookies')
  assert.equal(sets, 1, 'in one set')
})
