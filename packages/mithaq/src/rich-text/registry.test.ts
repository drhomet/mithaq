import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { checkRichTextSupport, type NodeRegistration, type RichTextProfile } from 'mithaq/rich-text/registry'

const registration: NodeRegistration = { type: 'link', json: { writes: 1, reads: [1] }, support: { admin: 'edit', 'lynx-viewer': 'none', 'native-android': 'none', 'native-ios': 'none' } }
const profile: RichTextProfile = { name: 'cluster-like', nodes: ['link'], requirements: { admin: { default: 'edit' }, 'lynx-viewer': { default: 'view' } } }

const cli = (args: string[]) => spawnSync(process.execPath, ['packages/mithaq/src/rich-text/check.ts', ...args], { encoding: 'utf8' })

const withModules = (run: (paths: { profile: string; registry: string; folder: string }) => void) => {
  const folder = mkdtempSync(join(process.cwd(), '.rich-text-check-'))
  try {
    const paths = { profile: join(folder, 'profile.mjs'), registry: join(folder, 'registry.mjs'), folder }
    writeFileSync(paths.profile, `export default ${JSON.stringify(profile)}`)
    writeFileSync(paths.registry, `export default ${JSON.stringify([registration])}`)
    run(paths)
  } finally { rmSync(folder, { recursive: true, force: true }) }
}

test('a missing viewer warns through the public check and CLI, failing only with strict', () => {
  const diagnostics = checkRichTextSupport({ registry: [registration], profile })
  assert.deepEqual(diagnostics, [{ severity: 'warning', code: 'support-gap', profile: 'cluster-like', node: 'link', place: 'lynx-viewer', required: 'view', available: 'none', remedy: 'Install support for this node at this place or revise the profile requirement.' }])
  withModules((paths) => {
    const args = ['--profile', paths.profile, '--registry', paths.registry]
    const normal = cli(args)
    assert.equal(normal.status, 0, normal.stderr)
    assert.deepEqual(JSON.parse(normal.stdout), diagnostics[0])
    assert.equal(cli([...args, '--strict']).status, 1)
  })
})

test('native editing requires real references in the installed contract through the function and CLI', () => {
  const nativeProfile: RichTextProfile = { name: 'phone', nodes: ['link'], requirements: {} }
  for (const place of ['native-android', 'native-ios'] as const) {
    for (const native of [undefined, [], ['none'], ['paragraphs.h1'], ['formats.bold']]) {
      const node = { ...registration, support: { ...registration.support, [place]: 'edit' as const }, native }
      const contract = { formats: { bold: 2 }, paragraphs: ['p', 'h2', 'h3'] }
      const diagnostics = checkRichTextSupport({ registry: [node], profile: nativeProfile, contract })
      assert.equal(diagnostics.length, 1)
      assert.equal(diagnostics[0]?.severity, 'error')
      assert.equal(diagnostics[0]?.place, place)
      withModules((paths) => {
        writeFileSync(paths.profile, `export default ${JSON.stringify(nativeProfile)}`)
        writeFileSync(paths.registry, `export default ${JSON.stringify([node])}`)
        const contractPath = join(paths.folder, 'contract.json')
        writeFileSync(contractPath, JSON.stringify(contract))
        const result = cli(['--profile', paths.profile, '--registry', paths.registry, '--contract', contractPath])
        assert.equal(result.status, 1)
        assert.equal(JSON.parse(result.stdout).severity, 'error', result.stderr)
      })
    }
  }
  const node: NodeRegistration = { ...registration, native: ['formats.bold', 'paragraphs.p'], support: { ...registration.support, 'native-ios': 'edit' } }
  assert.deepEqual(checkRichTextSupport({ registry: [node], profile: nativeProfile, contract: { formats: { bold: 1 }, paragraphs: ['p'] } }), [])
})
