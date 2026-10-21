import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

test('shipped native forms keep personal values in POST bodies before JavaScript runs', async () => {
  const root = new URL('../', import.meta.url)
  const files = execFileSync('git', ['ls-files', '-z', 'apps/**/*.tsx', 'packages/mithaq-admin/registry/**/*.tsx', 'templates/**/*.tsx'], { cwd: fileURLToPath(root), encoding: 'utf8' }).split('\0').filter(Boolean)
  const failures: string[] = []
  for (const file of files) {
    const source = await readFile(new URL(file, root), 'utf8')
    for (const form of source.matchAll(/<form\b([^>]*?)(?:onSubmit|>)/g)) {
      if (!/\bmethod="post"/.test(form[1]!)) failures.push(file)
    }
  }
  assert.deepEqual(failures, [], 'every native form needs an explicit POST, including forms whose inputs are not named yet')
})
