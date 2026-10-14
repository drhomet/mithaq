import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defaultResendBaseURL, logMailer, resendMailer } from './mailers.ts'
import { mailerFromEnv } from './index.ts'

const mail = { to: 'reader@example.com', subject: 'Hello', text: 'Plain words', html: '<p>Plain words</p>' }

test('the Resend mailer posts one message to Resend\'s API, authorized by the key, from the configured address', async (t) => {
  const sent: { url: string; init: RequestInit }[] = []
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    sent.push({ url, init })
    return new Response('{"id":"1"}', { status: 200 })
  })
  await resendMailer({ apiKey: 're_test', from: 'Asas <mail@example.com>', baseURL: defaultResendBaseURL }).send(mail)
  assert.equal(sent.length, 1)
  assert.equal(sent[0]!.url, 'https://api.resend.com/emails')
  assert.equal(sent[0]!.init.method, 'POST')
  assert.equal((sent[0]!.init.headers as Record<string, string>).authorization, 'Bearer re_test')
  assert.deepEqual(JSON.parse(String(sent[0]!.init.body)), { from: 'Asas <mail@example.com>', to: ['reader@example.com'], subject: 'Hello', text: 'Plain words', html: '<p>Plain words</p>' })
})

test('the Resend mailer posts to the base URL it is given, so a test run catches its mail on this machine', async (t) => {
  const sent: string[] = []
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    sent.push(url)
    return new Response('{"id":"1"}', { status: 200 })
  })
  await resendMailer({ apiKey: 're_test', from: 'mail@example.com', baseURL: 'http://127.0.0.1:9/resend' }).send(mail)
  await mailerFromEnv({ RESEND_API_KEY: 're_x', MAIL_FROM: 'mail@example.com', RESEND_BASE_URL: 'http://127.0.0.1:9/from-env' })!.send(mail)
  await mailerFromEnv({ RESEND_API_KEY: 're_x', MAIL_FROM: 'mail@example.com' })!.send(mail)
  assert.deepEqual(sent, ['http://127.0.0.1:9/resend/emails', 'http://127.0.0.1:9/from-env/emails', 'https://api.resend.com/emails'])
})

test('a message Resend refuses throws, naming the status and not the address', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('{"message":"bad key"}', { status: 401 }))
  await assert.rejects(resendMailer({ apiKey: 're_bad', from: 'mail@example.com', baseURL: defaultResendBaseURL }).send(mail), (error: Error) => error.message.includes('401') && !error.message.includes('reader@example.com'))
})

test('the log mailer writes the message to the server log and sends nothing', async (t) => {
  const logged: string[] = []
  t.mock.method(console, 'log', (line: string) => logged.push(line))
  const fetched = t.mock.method(globalThis, 'fetch', async () => new Response())
  await logMailer.send(mail)
  assert.equal(fetched.mock.callCount(), 0)
  assert.match(logged.join('\n'), /reader@example\.com[\s\S]*Hello[\s\S]*Plain words/)
})

test('the project\'s mailer is Resend with both settings, none with neither, and half the settings is refused', () => {
  assert.equal(mailerFromEnv({}), undefined)
  assert.ok(mailerFromEnv({ RESEND_API_KEY: 're_x', MAIL_FROM: 'mail@example.com' }))
  assert.throws(() => mailerFromEnv({ RESEND_API_KEY: 're_x' }), /MAIL_FROM/)
  assert.throws(() => mailerFromEnv({ MAIL_FROM: 'mail@example.com' }), /RESEND_API_KEY/)
})
