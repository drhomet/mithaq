import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

test('CI refuses to skip native auth checks when Chromium is not configured or is missing', () => {
  const root = fileURLToPath(new URL('../', import.meta.url))
  for (const ci of ['true', '', 'false']) for (const executable of [undefined, '/missing-auth-test-chromium']) {
    const env: NodeJS.ProcessEnv = { ...process.env, CI: ci }
    delete env.AUTH_BROWSER_EXECUTABLE
    if (executable) env.AUTH_BROWSER_EXECUTABLE = executable
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', "import { authPostBrowser } from './apps/auth-post-browser.ts'; const browser = await authPostBrowser(); await browser?.close()"], { cwd: root, env, encoding: 'utf8', timeout: 15_000 })
    assert.notEqual(result.status, 0, 'CI must not silently pass without its browser')
    assert.match(result.stderr, /AUTH_BROWSER_EXECUTABLE|executable doesn't exist/i)
  }
})
