import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
