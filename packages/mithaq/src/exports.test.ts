import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const folder = fileURLToPath(new URL('..', import.meta.url))
const manifest = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8')) as {
  exports: Record<string, string>
  bin: Record<string, string>
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
  peerDependencies: Record<string, string>
  peerDependenciesMeta: Record<string, { optional?: boolean }>
}
const lexical = (name: string) => name === 'lexical' || name.startsWith('@lexical/')

/** Every package a file names, each with the first file that names it, followed through every relative import. */
const reach = (roots: string[]) => {
  const seen = new Set<string>()
  const named = new Map<string, string>()
  const walk = (file: string) => {
    if (seen.has(file)) return
    seen.add(file)
    // A type import counts: the published declaration keeps it, and a project without Lexical cannot resolve it.
    // Statements open a line, so most code a generator writes inside a template string is not read as an import;
    // a specifier holding `${` is such code too. A bundler hint may sit inside `import(`.
    for (const hit of readFileSync(file, 'utf8').matchAll(/^\s*(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]|\bimport\(\s*(?:\/\*[^]*?\*\/\s*)?['"]([^'"]+)['"]/gm)) {
      const specifier = (hit[1] ?? hit[2] ?? hit[3])!
      if (specifier.includes('${')) continue
      if (specifier.startsWith('.')) walk(join(dirname(file), specifier))
      else if (!named.has(specifier)) named.set(specifier, relative(folder, file))
    }
  }
  for (const root of roots) walk(join(folder, root))
  return named
}

test('no entry point but mithaq/rich-text reaches Lexical, followed through every file it imports', () => {
  const core = Object.entries(manifest.exports).filter(([entry]) => entry !== './rich-text').map(([, file]) => file)
  const reached = reach([...core, ...Object.values(manifest.bin)])
  assert.deepEqual([...reached].filter(([name]) => lexical(name) || name === 'mithaq/rich-text').map(([name, by]) => `${by} imports ${name}`), [])
  assert.ok([...reach([manifest.exports['./rich-text']!]).keys()].some(lexical), 'and the walk does find it through mithaq/rich-text')
})

test('Lexical is an optional peer at the version the tests run, so a project without rich text installs none', () => {
  assert.deepEqual(Object.keys(manifest.dependencies).filter(lexical), [])
  const peers = Object.keys(manifest.peerDependencies).filter(lexical).sort()
  assert.deepEqual(peers, ['@lexical/code-core', '@lexical/extension', '@lexical/link', '@lexical/list', '@lexical/rich-text', '@lexical/table', 'lexical'])
  for (const name of peers) {
    assert.equal(manifest.peerDependencies[name], manifest.devDependencies[name], `${name} is tested at the version it asks for`)
    assert.equal(manifest.peerDependenciesMeta[name]?.optional, true, `${name} is optional`)
  }
})
