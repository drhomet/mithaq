import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

test('the Next host leaves jobs to platform cron because serverless timers can freeze', async () => {
  const source = await readFile(new URL('./asas-next/src/instrumentation.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /work:/)
})
