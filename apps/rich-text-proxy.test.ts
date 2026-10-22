import assert from 'node:assert/strict'
import { test } from 'node:test'
import { once } from 'node:events'
import { createServer, request as httpRequest } from 'node:http'
import { createRequire } from 'node:module'
import { base, betterAuth, betterAuthTenant, defaultAuthorize, defaultBulkLimit, defaultDepth, defaultFields, defaultJoinLimit, defaultJsonMaxBytes, defaultLimit, defaultMaxBodyBytes, defaultMaxLimit, defaultOperations, defineMithaq, fetchHttp, serviceTarget, zodIdKinds, zodKinds, zodRules, zodTarget } from '../packages/mithaq/src/index.ts'
import { defaultNodes, richText } from '../packages/mithaq/src/rich-text/index.ts'
import { memoryStore } from '../templates/asas/src/memory-store.ts'

// The provider owns the public base URL and trusted origins; the proxy forwards plain HTTP.
const { betterAuth: provider } = createRequire(new URL('../packages/mithaq/package.json', import.meta.url))('better-auth')

test('comment writes behind a TLS proxy use the provider public URL and trusted origins over a real socket', async () => {
  const auth = provider({ baseURL: 'https://public.example.test', trustedOrigins: ['https://trusted.example.test'], secret: 'dummy-proxy-test-secret-at-least-32-characters' })
  const language = defineMithaq({ arkan: [base, richText({ nodes: defaultNodes, features: ['comments'], comments: { threads: 'threads' } })], targets: {
    store: memoryStore(),
    zod: zodTarget({ idKinds: zodIdKinds, kinds: zodKinds, rules: zodRules }),
    tenant: betterAuthTenant({ relationTo: 'organizations', onDelete: 'restrict', newRows: 'active', organizations: 'many' }),
    service: serviceTarget({ store: 'store', schema: 'zod', depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, authorize: defaultAuthorize, audit: async () => {} }),
  } })
  const common = { targets: { service: { operations: defaultOperations } } }
  const organizations = language.defineKayan({ ...common, name: 'organizations', fields: { id: { kind: 'text' } } })
  const user = language.defineKayan({ ...common, name: 'user', auth: betterAuth({ server: () => auth }), fields: { id: { kind: 'text' } } })
  const records = language.defineKayan({ ...common, name: 'records', fields: { ...defaultFields, organization: language.targets.tenant.field, body: { kind: 'richText' } } })
  const threads = language.defineKayan({ name: 'threads', targets: { service: { operations: {} } }, fields: { ...defaultFields, organization: language.targets.tenant.field, recordKayan: { kind: 'text' }, recordId: { kind: 'text' }, field: { kind: 'text' }, quote: { kind: 'text' }, resolved: { kind: 'checkbox' }, comments: { kind: 'json', maxBytes: defaultJsonMaxBytes } } })
  const built = language.buildAsas({ kayan: [organizations, user, records, threads], http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: (error) => { throw error } })], auth: { maxBodyBytes: defaultMaxBodyBytes, onError: (error) => { throw error } } })
  const server = createServer(async (incoming, outgoing) => {
    const chunks: Buffer[] = []
    for await (const chunk of incoming) chunks.push(Buffer.from(chunk))
    const headers = new Headers()
    for (const [name, value] of Object.entries(incoming.headers)) if (value) headers.set(name, Array.isArray(value) ? value.join(', ') : value)
    const response = await built.handler(new Request(`http://${incoming.headers.host}${incoming.url}`, { method: 'POST', headers, body: Buffer.concat(chunks) }))
    outgoing.writeHead(response.status, Object.fromEntries(response.headers))
    outgoing.end(Buffer.from(await response.arrayBuffer()))
  })
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const { port } = server.address() as { port: number }
    const post = (origin?: string) => new Promise<number>((resolve, reject) => {
      const request = httpRequest({ host: '127.0.0.1', port, path: '/api/rich-text/comments/records/dummy/body', method: 'POST', headers: { host: 'public.example.test', 'x-forwarded-proto': 'https', 'content-type': 'application/json', ...(origin && { origin }) } }, (response) => { response.resume(); resolve(response.statusCode!) })
      request.on('error', reject)
      request.end('{}')
    })
    assert.equal(await post('https://public.example.test'), 400, 'the configured public origin reaches input validation')
    assert.equal(await post('https://trusted.example.test'), 400, 'a configured trusted origin reaches input validation')
    for (const origin of [undefined, 'http://public.example.test', 'https://evil.example.test']) assert.equal(await post(origin), 403, 'a forwarded-proto header cannot grant trust')
  } finally {
    server.close()
    await built.destroy()
  }
})
