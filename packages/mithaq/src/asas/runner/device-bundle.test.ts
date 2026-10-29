import assert from 'node:assert/strict'
import { builtinModules } from 'node:module'
import { test } from 'node:test'
import { build } from 'esbuild'

test('a complete two-kayan device asas bundles for a neutral runtime with no Node dependencies', async () => {
  const entry = new URL('../../device.ts', import.meta.url).pathname
  const source = `
    import { defineMithaq, base, sqliteAdapter, drizzleSqliteKinds, drizzleSqliteRules, drizzleSqliteIdKinds,
      zodTarget, zodKinds, zodRules, zodIdKinds, serviceTarget, defaultAuthorize, defaultDepth,
      defaultLimit, defaultMaxLimit, defaultJoinLimit, defaultBulkLimit, defaultFields, defaultOperations } from ${JSON.stringify(entry)}
    export const device = ({ db, transaction }) => {
      const language = defineMithaq({ locales: ['en', 'ar'], arkan: [base], targets: {
        sqlite: sqliteAdapter({ db, transaction, kinds: drizzleSqliteKinds, rules: drizzleSqliteRules, idKinds: drizzleSqliteIdKinds }),
        zod: zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }),
        service: serviceTarget({ store: 'sqlite', schema: 'zod', authorize: defaultAuthorize, depth: defaultDepth,
          defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultMaxLimit }),
      } })
      const access = { create: () => true, read: () => true, update: () => true, delete: () => true }
      const patient = language.defineKayan({ name: 'patient', placement: 'device', access, fields: { ...defaultFields }, targets: { service: { operations: defaultOperations } } })
      const note = language.defineKayan({ name: 'note', placement: 'device', access, fields: { ...defaultFields }, targets: { service: { operations: defaultOperations } } })
      return language.buildAsas({ kayan: [patient, note], http: [] })
    }
  `
  const built = await build({ stdin: { contents: source, resolveDir: process.cwd(), sourcefile: 'device-app.ts', loader: 'ts' }, bundle: true, platform: 'neutral', mainFields: ['module', 'main'], format: 'esm', write: false, metafile: true })
  assert.deepEqual(built.metafile.outputs['stdin.js']?.imports ?? [], [])
  for (const path of Object.keys(built.metafile.inputs)) {
    assert.ok(!path.startsWith('node:') && !builtinModules.includes(path), path)
    assert.doesNotMatch(path, /sqlite-proxy|node-postgres|auth\/local|storage\/storage/)
  }
  const code = built.outputFiles[0]!.text
  assert.doesNotMatch(code, /\b(?:from|import)\s*(?:\(\s*)?["']node:/)
  assert.doesNotMatch(code, /AsyncLocalStorage|node:crypto|node:fs/)
  const module = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
  assert.equal(typeof module.device, 'function')
})
