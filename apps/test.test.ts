import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { testWorkers } from './test.ts'

test('test workers follow the memory threshold unless the caller names a count', () => {
  assert.equal(testWorkers({ freePercent: 50 }), 2)
  assert.equal(testWorkers({ freePercent: 49 }), 1)
  assert.equal(testWorkers({ freePercent: undefined }), 1)
  assert.equal(testWorkers({ freePercent: 99, override: '1' }), 1)
  assert.equal(testWorkers({ freePercent: 40, override: '2' }), 2)
  for (const override of ['0', '-1', '1.5', 'two', '']) {
    assert.throws(() => testWorkers({ freePercent: 90, override }), /positive integer/)
  }
})

test('a focused file with no templates succeeds without a database or with an unreachable database', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mithaq-focused-'))
  const file = join(directory, 'focused.test.ts')
  await writeFile(file, "import { test } from 'node:test'; test('focused without a store', () => {})\n")
  try {
    for (const database of [undefined, 'postgres://postgres:postgres@127.0.0.1:1/mithaq']) {
      const env = { ...process.env }
      delete env.NODE_TEST_CONTEXT
      for (const key of ['DATABASE_URL', 'DATABASE_URI', 'DATABASE_URI_V2', 'POSTGRES_URL']) {
        if (database) env[key] = database
        else delete env[key]
      }
      const result = spawnSync(process.execPath, [fileURLToPath(new URL('test.ts', import.meta.url)), '--workers', '1', file], { env, encoding: 'utf8', timeout: 15_000 })
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
      assert.match(result.stdout, /pass 1/)
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
