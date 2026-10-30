import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
    const args = ['--profile', paths.profile]
    const normal = cli(args)
    assert.equal(normal.status, 0, normal.stderr)
    assert.deepEqual(JSON.parse(normal.stdout), diagnostics[0])
    assert.equal(cli([...args, '--strict']).status, 1)
  })
})

test('native editing requires real references in the installed contract and a codec that carries the node', () => {
  const nativeProfile: RichTextProfile = { name: 'phone', nodes: ['link'], requirements: {} }
  const contract = { formats: { bold: 2 }, paragraphs: ['p', 'h2', 'h3'] }
  for (const place of ['native-android', 'native-ios'] as const) {
    for (const native of [undefined, [], ['none']]) {
      const node = { ...registration, support: { ...registration.support, [place]: 'edit' as const }, native }
      assert.deepEqual(checkRichTextSupport({ registry: [node], profile: nativeProfile, contract, codecs: ['link'] }).map(({ severity, code, place }) => ({ severity, code, place })), [{ severity: 'error', code: 'native-reference-required', place }])
    }
  }
  const resolving: NodeRegistration = { ...registration, native: ['formats.bold', 'paragraphs.p'], support: { ...registration.support, 'native-ios': 'edit' } }
  const installed = { formats: { bold: 1 }, paragraphs: ['p'] }
  assert.deepEqual(checkRichTextSupport({ registry: [resolving], profile: nativeProfile, contract: installed, codecs: ['link'] }), [])
  for (const codecs of [undefined, [], ['text']]) {
    assert.deepEqual(checkRichTextSupport({ registry: [resolving], profile: nativeProfile, contract: installed, codecs }).map(({ severity, code, place }) => ({ severity, code, place })), [{ severity: 'error', code: 'native-codec-missing', place: 'native-ios' }])
  }
})

test('an unresolved native reference is one error per node, whatever the node claims', () => {
  const nativeProfile: RichTextProfile = { name: 'phone', nodes: ['link'], requirements: {} }
  const both = { 'native-android': 'edit', 'native-ios': 'edit' } as const
  for (const [native, support] of [[['paragraphs.h1'], both], [['formats.bold'], both], [['paragraphs.h1'], {}]] as const) {
    const node: NodeRegistration = { ...registration, native, support: { ...registration.support, ...support } }
    assert.deepEqual(checkRichTextSupport({ registry: [node], profile: nativeProfile, contract: { formats: { bold: 2 }, paragraphs: ['p'] }, codecs: ['link'] }), [{ severity: 'error', code: 'native-reference-unresolved', profile: 'phone', node: 'link', place: null, required: 'none', available: 'none', remedy: 'Declare only native references the installed rich-input contract resolves.' }])
  }
})

test('the initial inventory names exactly the selected classes and proves every written and readable JSON version', async () => {
  const { defaultNodeRegistry } = await import('mithaq/rich-text/registry')
  const { defaultNodes, UploadNode, typesOf, versionsOf, richTextReader } = await import('./rich-text.ts')
  const { AutoLinkNode } = await import('@lexical/link')
  const { richTextFeatureNodes, richTextFeatures } = await import('./index.ts')
  const { createEditor } = await import('lexical')
  const nodes = [...defaultNodes, AutoLinkNode, UploadNode, ...richTextFeatureNodes(richTextFeatures)]
  const types = typesOf(nodes)
  assert.deepEqual(defaultNodeRegistry.map((node) => node.type).sort(), [...types].sort())
  const versions = versionsOf(nodes)
  const text = { type: 'text', version: 1, text: 'Hello مرحبا', format: 0, style: '', mode: 'normal', detail: 0 }
  const paragraph = { type: 'paragraph', version: 1, children: [text], format: '', indent: 0, direction: null }
  const fixtures: Record<string, object> = {
    root: { type: 'root', version: 1, children: [paragraph] }, paragraph, text,
    linebreak: { type: 'linebreak', version: 1 }, tab: { ...text, type: 'tab', text: '\t' },
    heading: { ...paragraph, type: 'heading', tag: 'h1' }, quote: { ...paragraph, type: 'quote' },
    list: { ...paragraph, type: 'list', listType: 'number', tag: 'ol', start: 3, children: [{ ...paragraph, type: 'listitem', value: 3 }] },
    listitem: { ...paragraph, type: 'listitem', value: 1 },
    link: { ...paragraph, type: 'link', url: 'https://example.com', rel: null, target: null, title: null },
    autolink: { ...paragraph, type: 'autolink', url: 'https://example.com', isUnlinked: false },
    horizontalrule: { type: 'horizontalrule', version: 1 },
    upload: { type: 'upload', version: 3, relationTo: 'files', value: 'synthetic-file', id: 'synthetic-node', fields: null, format: '' },
    table: { ...paragraph, type: 'table', children: [{ ...paragraph, type: 'tablerow', children: [{ ...paragraph, type: 'tablecell', headerState: 0, children: [paragraph] }] }] },
    tablerow: { ...paragraph, type: 'tablerow', children: [{ ...paragraph, type: 'tablecell', headerState: 0, children: [paragraph] }] },
    tablecell: { ...paragraph, type: 'tablecell', headerState: 0, children: [paragraph] },
    code: { ...paragraph, type: 'code', language: 'javascript' }, 'code-highlight': { ...text, type: 'code-highlight', highlightType: 'keyword' },
    mark: { ...paragraph, type: 'mark', ids: ['00000000-0000-4000-8000-000000000001'] },
    hashtag: { ...text, type: 'hashtag', text: '#hello' },
    mention: { ...text, type: 'mention', text: '@Huda', mode: 'token', kayan: 'user', id: 'synthetic-user', name: 'Huda' },
  }
  // mithaq's UploadNode has written v3 since it was added; v1 and v2 are Payload's shapes, which differ:
  // v1 held the file as `{ id }` and neither had the node's own id (Payload's UploadServerNode.importJSON).
  const uploads: Record<number, object> = {
    1: { type: 'upload', version: 1, relationTo: 'files', value: { id: 'synthetic-file' }, fields: null, format: '' },
    2: { type: 'upload', version: 2, relationTo: 'files', value: 'synthetic-file', fields: null, format: '' },
  }
  const editor = createEditor({ nodes, onError: (error) => { throw error } })
  const read = richTextReader(nodes)
  for (const registration of defaultNodeRegistry) {
    assert.equal(versions.get(registration.type), registration.json.writes, registration.type)
    assert.deepEqual(registration.json.reads, Array.from({ length: registration.json.writes }, (_, index) => index + 1))
    for (const version of registration.json.reads) {
      const fixture = (registration.type === 'upload' && uploads[version]) || { ...fixtures[registration.type], version }
      let block: object = fixture
      if (['text', 'linebreak', 'tab', 'link', 'autolink', 'mark', 'hashtag', 'mention'].includes(registration.type)) block = { ...paragraph, children: [fixture] }
      if (registration.type === 'code-highlight') block = { ...fixtures.code, children: [fixture] }
      if (registration.type === 'listitem') block = { ...fixtures.list, children: [fixture] }
      if (registration.type === 'tablecell') block = { ...fixtures.tablerow, children: [fixture] }
      if (['tablerow', 'tablecell'].includes(registration.type)) block = { ...fixtures.table, children: [block] }
      const value = { root: registration.type === 'root' ? fixture : { ...fixtures.root, children: [block] } }
      assert.ok(!('refused' in read(value)), `${registration.type} reads v${version}`)
      const exported = editor.parseEditorState(value as import('lexical').SerializedEditorState).toJSON()
      const find = (node: import('./value.ts').RichTextNode): import('./value.ts').RichTextNode | undefined => node.type === registration.type ? node : node.children?.map(find).find(Boolean)
      assert.equal(find(exported.root)?.version, registration.json.writes, `${registration.type} writes v${registration.json.writes}`)
    }
  }
  assert.ok(defaultNodeRegistry.every((node) => node.support.admin === 'edit' && node.support['lynx-viewer'] === 'none' && node.support['native-ios'] === 'none' && node.support['native-android'] === 'none'))
})

test('profile typos and field policies warn for each required place with stable sorted diagnostics', () => {
  const selected: RichTextProfile = { name: 'check', nodes: ['link', 'missing', 'text'], requirements: { 'native-ios': { default: 'edit', nodes: { typo: 'view', heading: 'edit' } }, admin: { default: 'edit' } } }
  const text: NodeRegistration = { ...registration, type: 'text' }
  const registry = [registration, text]
  const policies = [{ features: ['link', 'bold', 'checklist'] as const, fonts: ['sans'] as const }]
  const diagnostics = checkRichTextSupport({ registry, profile: selected, policies })
  assert.ok(diagnostics.some((item) => item.code === 'profile-node-unknown' && item.node === 'missing'))
  assert.ok(diagnostics.some((item) => item.code === 'profile-node-unselected' && item.node === 'typo'))
  assert.ok(diagnostics.some((item) => item.code === 'profile-node-unselected' && item.node === 'heading'))
  for (const feature of ['link', 'bold', 'checklist']) assert.ok(diagnostics.some((item) => item.code === 'policy-support-gap' && item.feature === feature && item.place === 'native-ios' && item.required === 'edit'))
  assert.ok(!diagnostics.some((item) => item.code === 'policy-support-gap' && item.feature === 'link' && item.place === 'admin'))
  assert.deepEqual(checkRichTextSupport({ registry: [...registry].reverse(), profile: { ...selected, nodes: [...selected.nodes].reverse() }, policies: [...policies, ...policies] }), diagnostics)
  assert.ok(diagnostics.every((item) => item.severity === 'warning' && item.remedy && item.profile === selected.name))
})

test('field policies are checked only where the profile asks a place to edit', async () => {
  const { defaultNodeRegistry } = await import('mithaq/rich-text/registry')
  const { richTextFeatures } = await import('./policy.ts')
  const nodes = defaultNodeRegistry.map((node) => node.type)
  const policies = [{ features: richTextFeatures, fonts: ['sans'] as const, comments: { threads: 'threads' } }]
  const viewing: RichTextProfile = { name: 'cluster-like', nodes, requirements: { admin: { default: 'edit' }, 'lynx-viewer': { default: 'view' } } }
  assert.ok(!checkRichTextSupport({ registry: defaultNodeRegistry, profile: viewing, policies }).some((item) => item.code === 'policy-support-gap'))
  const override: RichTextProfile = { ...viewing, requirements: { 'lynx-viewer': { default: 'view', nodes: { link: 'edit' } } } }
  const gaps = checkRichTextSupport({ registry: defaultNodeRegistry, profile: override, policies: [{ features: ['link', 'bold', 'headings'], fonts: ['sans'] }] }).filter((item) => item.code === 'policy-support-gap')
  assert.deepEqual(gaps.map((item) => `${item.feature}:${item.node}`), ['link:link'])
})

test('tools without a node of their own are checked on the node they act on', async () => {
  const { defaultNodeRegistry } = await import('mithaq/rich-text/registry')
  const features = ['alignment', 'indent', 'direction', 'styling', 'markdown', 'counter', 'findReplace'] as const
  const profile: RichTextProfile = { name: 'phone', nodes: defaultNodeRegistry.map((node) => node.type), requirements: { 'lynx-viewer': { default: 'edit' } } }
  const gaps = checkRichTextSupport({ registry: defaultNodeRegistry, profile, policies: [{ features, fonts: ['sans'] }] }).filter((item) => item.code === 'policy-support-gap')
  assert.deepEqual(gaps.map((item) => `${item.feature}:${item.node}`).sort(), ['alignment:paragraph', 'counter:text', 'direction:paragraph', 'findReplace:text', 'indent:paragraph', 'markdown:text', 'styling:text'])
  const { richTextFeatures } = await import('./policy.ts')
  const every = checkRichTextSupport({ registry: defaultNodeRegistry, profile, policies: [{ features: richTextFeatures, fonts: ['sans'], comments: { threads: 'threads' } }] })
  assert.deepEqual(new Set(every.map((item) => item.feature).filter(Boolean)), new Set(richTextFeatures), 'every feature acts on some node')
})

test('the CLI defaults to the inventory, accepts policies, and rejects unreadable or malformed inputs without leaking their contents', () => {
  withModules((paths) => {
    const policyPath = join(paths.folder, 'policies.mjs')
    writeFileSync(policyPath, `export default [{ features: ['link'], fonts: ['sans'] }]`)
    writeFileSync(paths.profile, `export default ${JSON.stringify({ ...profile, requirements: { 'lynx-viewer': { default: 'edit' } } })}`)
    const normal = cli(['--profile', paths.profile, '--policies', policyPath])
    assert.equal(normal.status, 0, normal.stderr)
    assert.ok(normal.stdout.includes('policy-support-gap'))
    for (const args of [[], ['--unknown'], ['--strict=false'], ['--profile'], ['--profile', join(paths.folder, 'missing.mjs')], ['--profile', paths.profile, '--contract', paths.profile], ['--profile', paths.profile, '--policies', paths.registry], ['--profile', paths.profile, '--registry', paths.registry]]) {
      const result = cli(args)
      assert.equal(result.status, 1)
      assert.equal(JSON.parse(result.stderr).severity, 'error')
      assert.ok(!result.stderr.includes(paths.folder))
    }
    for (const value of [null, {}, { ...profile, requirements: { typo: { default: 'edit' } } }, { ...profile, requirements: { admin: { default: 'none' } } }, { ...profile, strict: true }]) {
      writeFileSync(paths.profile, `export default ${JSON.stringify(value)}`)
      assert.equal(cli(['--profile', paths.profile]).status, 1)
    }
    writeFileSync(paths.profile, `throw new Error('DOCUMENT-TEXT-MUST-STAY-PRIVATE')`)
    const error = cli(['--profile', paths.profile])
    assert.equal(error.status, 1)
    assert.ok(!error.stderr.includes('DOCUMENT-TEXT-MUST-STAY-PRIVATE'))
  })
})

// @ts-expect-error every place is explicit even when it has no support
const incompleteSupport: NodeRegistration['support'] = { admin: 'edit' }
void incompleteSupport

test('support ranks, node overrides and omitted places do not invent requirements', () => {
  const node: NodeRegistration = { ...registration, support: { ...registration.support, 'lynx-viewer': 'view' } }
  assert.deepEqual(checkRichTextSupport({ registry: [node], profile }), [])
  assert.deepEqual(checkRichTextSupport({ registry: [node], profile: { ...profile, requirements: {} } }), [])
  const override: RichTextProfile = { ...profile, requirements: { 'lynx-viewer': { default: 'edit', nodes: { link: 'view' } } } }
  assert.deepEqual(checkRichTextSupport({ registry: [node], profile: override }), [])
  assert.equal(checkRichTextSupport({ registry: [node], profile: { ...override, requirements: { 'lynx-viewer': { default: 'edit' } } } })[0]?.code, 'support-gap')
  assert.equal(checkRichTextSupport({ registry: [], profile: { ...profile, requirements: {} } })[0]?.code, 'profile-node-unknown')
})

test('native format policies use the shared bits rather than assuming a native edit claim covers every format', () => {
  const node: NodeRegistration = { ...registration, type: 'text', native: ['formats.bold'], support: { ...registration.support, 'native-ios': 'edit' } }
  const profile: RichTextProfile = { name: 'native', nodes: ['text'], requirements: { 'native-ios': { default: 'edit' } } }
  const diagnostics = checkRichTextSupport({ registry: [node], profile, policies: [{ features: ['bold', 'italic'], fonts: ['sans'] }], contract: { formats: { bold: 1, italic: 2 } }, codecs: ['text'] })
  assert.equal(diagnostics.length, 1)
  assert.equal(diagnostics[0]?.feature, 'italic')
  assert.equal(diagnostics[0]?.code, 'policy-support-gap')
})

test('the registry bundles and runs without Lexical, React, DOM or runtime imports', async () => {
  const { build } = await import('esbuild')
  const { runInNewContext } = await import('node:vm')
  const result = await build({ entryPoints: ['packages/mithaq/src/rich-text/registry.ts'], bundle: true, platform: 'neutral', format: 'iife', globalName: 'registry', write: false, metafile: true })
  assert.deepEqual(Object.keys(result.metafile!.inputs).sort(), ['packages/mithaq/src/rich-text/feature-data.ts', 'packages/mithaq/src/rich-text/registry.ts'])
  const context: { registry?: typeof import('./registry.ts') } = {}
  runInNewContext(result.outputFiles[0]!.text, context)
  assert.equal(context.registry!.defaultNodeRegistry.length, 21)
  assert.equal(context.registry!.checkRichTextSupport({ registry: [registration], profile })[0]?.code, 'support-gap')
})

test('the CLI runs under Bun as well as Node 24 and both package manifests publish its separate bin', () => {
  const manifest = JSON.parse(readFileSync('packages/mithaq/package.json', 'utf8'))
  assert.equal(manifest.bin['mithaq-check-rich-text'], './src/rich-text/check.ts')
  assert.equal(manifest.publishConfig.bin['mithaq-check-rich-text'], 'dist/rich-text/check.js')
  withModules((paths) => {
    const result = spawnSync('bun', ['--no-env-file', 'packages/mithaq/src/rich-text/check.ts', '--profile', paths.profile], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout).code, 'support-gap')
    const strict = spawnSync('bun', ['--no-env-file', 'packages/mithaq/src/rich-text/check.ts', '--profile', paths.profile, '--strict'], { encoding: 'utf8' })
    assert.equal(strict.status, 1)
  })
})
