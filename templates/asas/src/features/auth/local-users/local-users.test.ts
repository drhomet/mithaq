import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ip } from './local-users.ts'

test('local ip reads TRUSTED_IP_HEADER, and falls back to x-forwarded-for when unset', () => {
  const request = new Request('http://test/api/auth/local/login', {
    headers: { 'x-forwarded-for': '203.0.113.1', 'cf-connecting-ip': '198.51.100.7' },
  })

  assert.equal(process.env.TRUSTED_IP_HEADER, undefined)
  assert.equal(ip(request), '203.0.113.1')

  process.env.TRUSTED_IP_HEADER = 'cf-connecting-ip'
  try {
    assert.equal(ip(request), '198.51.100.7')
  } finally {
    delete process.env.TRUSTED_IP_HEADER
  }
})

test('#199: building the template prints the no-mail notice as one line with no stack, which is what the template\'s auth.onError makes of a Notice', async () => {
  // A child process, because the notice is printed once per build and the
  // build is `src/asas.ts` being imported.
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const { stderr } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', "await import('./src/asas.ts')"], {
    cwd: new URL('../../../../', import.meta.url),
    env: { ...process.env, LOCAL_AUTH_SECRET: 'asas-local-auth-test-secret-of-32-characters' },
  })
  const notices = stderr.split('\n').filter((line) => line.includes('has no local({ email })'))
  assert.equal(notices.length, 1, stderr)
  assert.match(notices[0]!, /^\[mithaq local auth\] kayan "localUsers" has no local\(\{ email \}\)/)
  assert.doesNotMatch(stderr, /^\s+at /m, 'and no stack trace follows it')
})
