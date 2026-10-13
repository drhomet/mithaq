// The language is the first of the three steps: features import it and the asas imports both, so an import back from
// it into a feature or the asas would be a package cycle, which a hoisting install would hide until it bit.
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { test } from 'node:test'

test('the language imports no package of the project, itself and the asas among them, and no file outside its own package', async () => {
  const source = new URL('./', import.meta.url)
  const offending: string[] = []
  for (const file of await readdir(source, { recursive: true })) {
    // A test is the repository's, never the project's, and may reach the asas's test helpers.
    if (!/\.tsx?$/.test(file) || /\.(test|smoke)\.tsx?$/.test(file)) continue
    const text = await readFile(new URL(file, source), 'utf8')
    for (const [, specifier] of text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      const outside = specifier!.startsWith('.') && !new URL(specifier!, new URL(file, source)).href.startsWith(new URL('../', source).href)
      // Its own files by path, so the package never names itself, and the asas by neither its name nor a path.
      if (specifier!.startsWith('@asas/') || specifier === 'asas' || specifier!.startsWith('asas/') || outside) offending.push(`${file}: ${specifier}`)
    }
  }
  assert.deepEqual(offending, [])
})
