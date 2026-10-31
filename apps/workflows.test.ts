import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { availableParallelism, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

for (const [file, name] of [['ci.yml', 'packages'], ['release.yml', 'pack']] as const) test(`${file} uploads one artifact from Postgres 17 while both database checks gate release`, () => {
  const source = readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), 'utf8')
  const upload = source.split('      - uses: actions/upload-artifact@')[1]!
  assert.match(upload, /\n        if: matrix\.postgres == 17\n/)
  assert.match(upload, new RegExp(`name: ${name}\\n`))
  assert.match(source, /fail-fast: false/)
  assert.match(source, /postgres: \[17, 18\]/)
  if (file === 'release.yml') {
    assert.match(source, /needs: verify/)
    assert.match(source.split('actions/download-artifact@')[1]!, /name: pack\n/)
  }
})

test('CI passes the worker count Node used before the memory-based runner', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mithaq-ci-workers-'))
  try {
    await writeFile(join(directory, 'bun'), '#!/bin/sh\nprintf \'%s\\n\' "$@"\n', { mode: 0o755 })
    for (const file of ['ci.yml', 'release.yml']) {
      const source = readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), 'utf8')
      const command = /^\s*- run: (bun run test(?:\s.*)?)$/m.exec(source)?.[1]
      assert.ok(command)
      const args = execFileSync('/bin/sh', ['-c', command], { env: { ...process.env, PATH: `${directory}:${process.env.PATH}` }, encoding: 'utf8' }).trim().split('\n')
      assert.deepEqual(args, ['run', 'test', '--workers', String(Math.max(1, availableParallelism() - 1))])
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('every workflow installs Chromium before the suite, whose date picker check fails in CI without it', () => {
  for (const file of ['ci.yml', 'release.yml']) {
    const source = readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), 'utf8')
    const install = source.indexOf('playwright-core/cli.js install')
    assert.ok(install >= 0 && install < source.indexOf('- run: bun run test --'), file)
  }
})
