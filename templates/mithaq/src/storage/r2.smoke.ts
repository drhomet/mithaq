// The `r2` preset against a real Cloudflare R2 bucket, opt-in: it runs only
// when all four R2 settings are in the environment, which a person loads from
// a file of their own (`bun --env-file=<file> run test:r2`), and skips otherwise.
// It never prints a setting or a signed address, since a signed address carries
// the access key's id. Every object it makes is under `mithaq-smoke/` and is
// deleted whatever happens.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { defaultDisposition, defaultVerify } from './defaults.ts'
import { r2 } from './r2.ts'

const settings = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'] as const
const unset = settings.filter((name) => !process.env[name])
const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'))

test('r2: a signed PUT is stored, read back, verified, served through a signed GET and deleted', { skip: unset.length > 0 && `set ${unset.join(', ')} to run the live R2 check` }, async () => {
  const adapter = r2({
    accountId: process.env.R2_ACCOUNT_ID!,
    bucket: process.env.R2_BUCKET!,
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    prefix: 'mithaq-smoke',
  })
  const key = `mithaq-smoke/${randomUUID()}/smoke.png`
  try {
    const { request } = await adapter.uploadInstructions.generate({ filename: 'smoke.png', filesize: png.length, mimeType: 'image/png', key })
    const put = await fetch(request.url, { method: 'PUT', headers: request.headers, body: png })
    assert.equal(put.status, 200, 'R2 refused the signed PUT')
    // Once only: the signed If-None-Match refuses a second PUT that would replace a verified object.
    const again = await fetch(request.url, { method: 'PUT', headers: request.headers, body: png })
    assert.equal(again.status, 412, 'R2 took a second PUT over the first')
    assert.deepEqual(await adapter.head({ key }), { size: png.length })
    assert.deepEqual(await adapter.readHead({ key, bytes: 4100 }), png)
    assert.deepEqual(await defaultVerify({ adapter, key, mimeType: 'image/png', size: png.length, mimeTypes: ['image/png'], fileSize: 1024 }), { width: 1, height: 1 })
    const served = await adapter.staticHandler(new Request('http://localhost/'), {
      doc: { id: key, key, filename: 'smoke.png', mimeType: 'image/png', filesize: png.length, storage: 'r2' },
      disposition: defaultDisposition({ filename: 'smoke.png', mimeType: 'image/png' }),
    })
    assert.equal(served.status, 302, 'the file route answers with a redirect')
    const read = await fetch(served.headers.get('location')!)
    assert.equal(read.status, 200, 'R2 refused the signed GET')
    assert.deepEqual(new Uint8Array(await read.arrayBuffer()), png)
    await adapter.handleDelete({ key })
    assert.equal(await adapter.head({ key }), null, 'the object is gone after the delete')
  } finally {
    await adapter.handleDelete({ key }).catch(() => {})
  }
})
