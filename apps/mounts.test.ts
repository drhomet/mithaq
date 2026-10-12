import assert from 'node:assert/strict'
import test from 'node:test'
// The package's own entry, not `asas`: no `node_modules/asas` symlink is on this file's resolution path.
import { asas } from '../templates/asas/src/asas.ts'
import { DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT } from './asas-next/src/app/api/[[...rest]]/route.ts'
import { Route } from './asas-tanstack/src/routes/api/$.ts'

// Every case is refused before any store is reached, so no database is needed.
const cases = {
  auth: new Request('http://test/api/auth/local/reset-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }),
  rpc: new Request('http://test/api/rpc/courses/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: {} }),
  }),
  api: new Request('http://test/api/courses/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }),
  unowned: new Request('http://test/not-ours'),
}

const drive = async (mount: (request: Request) => Promise<Response>) => {
  const answered = {} as Record<keyof typeof cases, { status: number; text: string }>
  for (const [name, request] of Object.entries(cases)) {
    const response = await mount(request.clone())
    answered[name as keyof typeof cases] = { status: response.status, text: await response.text() }
  }
  return answered
}

test('1. the Next App Router catch-all is seven verb constants over asas.handler, and all three arms and the 404 answer through it', async () => {
  for (const [name, verb] of Object.entries({ GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS })) {
    assert.equal(verb, asas.handler, `${name} is asas.handler itself, so no verb takes a different path`)
  }

  const { auth, rpc, api, unowned } = await drive(GET)

  assert.equal(auth.status, 400, 'a request under /api/auth/<provider> reaches the auth arm, which refuses this body 400')
  assert.equal(
    (JSON.parse(auth.text) as { message?: string }).message,
    'A token and a password of 8 to 1024 characters are required.',
    'the refusal carries the local strategy\'s own message, so the auth arm answered and not the plug',
  )

  assert.equal(rpc.status, 400, 'a request under /api/rpc reaches the RPC arm, which refuses a create with no title 400')
  const rpcBody = JSON.parse(rpc.text) as { json?: { data?: { key?: string } } }
  assert.equal(
    rpcBody.json?.data?.key,
    'error.invalid.value',
    'the RPC arm answered, because the refusal carries the key inside the `json` envelope the RPC protocol wraps every body in',
  )

  assert.equal(api.status, 400, 'a request under /api reaches the plain HTTP arm, which refuses the same create 400')
  const apiBody = JSON.parse(api.text) as { json?: unknown; data?: { key?: string } }
  assert.equal(apiBody.data?.key, 'error.invalid.value', 'the plain HTTP arm answered, carrying the same key at the top level')
  assert.equal('json' in apiBody, false, 'the plain HTTP arm writes no RPC envelope, which is what tells the two arms apart')

  assert.equal(unowned.status, 404, 'a path the handler does not own comes back 404')
  assert.equal(unowned.text, 'Not found', 'the 404 is the handler\'s own, which is what the host has left after the plug answers null')
})

test('2. the TanStack route declares the handler at Route.options.server.handlers.ANY, and calling that entry directly answers every case the same way; the framework\'s own dispatch to it is untested until #25', async () => {
  const handlers = Route.options.server?.handlers
  assert.ok(handlers && !(handlers instanceof Function), 'the route keeps a handlers bag at Route.options.server.handlers rather than the function form of the same option')
  const any = handlers.ANY
  assert.ok(any, 'the bag holds ANY, which is the one entry a catch-all over every verb needs')

  // The framework hands its handler a whole match context; this mount reads one key, so the test passes that and casts.
  const through = await drive(async (request) => (await any({ request } as never)) as Response)
  const direct = await drive(asas.handler)

  assert.deepEqual(through, direct, 'every case answers through the route exactly as it answers through asas.handler, so the mount adds nothing and drops nothing')
  assert.equal(direct.auth.status, 400, 'the auth arm is one of the four that comparison covers')
  assert.equal(direct.rpc.status, 400, 'the RPC arm is one of the four')
  assert.equal(direct.api.status, 400, 'the plain HTTP arm is one of the four')
  assert.equal(direct.unowned.status, 404, 'the unowned path is the fourth, so the comparison is not over three matches and a gap')
})
