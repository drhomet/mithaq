import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { pathsOf, testWorkers } from './test.ts'

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

test('a shard runs its share of the files, so CI can split the suite across jobs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mithaq-shard-'))
  const files = ['a', 'b'].map((name) => join(directory, `${name}.test.ts`))
  for (const file of files) await writeFile(file, "import { test } from 'node:test'; test('one', () => {})\n")
  try {
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const ran = ['1/2', '2/2'].map((shard) => {
      const result = spawnSync(process.execPath, [fileURLToPath(new URL('test.ts', import.meta.url)), '--workers', '1', `--test-shard=${shard}`, ...files], { env, encoding: 'utf8', timeout: 15_000 })
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
      return result.stdout
    })
    for (const stdout of ran) assert.match(stdout, /pass 1\n/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('a shard is passed to node and never read as a file, so CI\'s shards still run the whole suite', () => {
  assert.deepEqual(pathsOf(['--workers', '3', '--test-shard=2/4']), [])
  assert.deepEqual(pathsOf(['--unit', '--workers=1', 'a.test.ts', '--test-shard=1/2']), ['a.test.ts'])
})
