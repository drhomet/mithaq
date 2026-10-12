// Each case runs in a child process whose resolver refuses `better-auth/db`, so
// only `generate auth` may load Better Auth's schema reader.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

const run = promisify(execFile)
const template = new URL('../../../../../templates/asas/', import.meta.url).pathname
const bin = new URL('./mithaq.ts', import.meta.url).pathname
const noSchema = `data:text/javascript,${encodeURIComponent(
  "import { registerHooks } from 'node:module'; registerHooks({ resolve(specifier, context, next) { if (specifier === 'better-auth/db') throw new Error(`better-auth/db was loaded from ${context.parentURL}`); return next(specifier, context) } })",
)}`
const mithaq = (...args: string[]) => run(process.execPath, ['--import', noSchema, bin, ...args], { cwd: template, env: { ...process.env } })

test('the refusal is real: generate auth loads better-auth/db', async () => {
  await assert.rejects(mithaq('generate', 'auth', '--check'), /better-auth\/db was loaded/)
})

test('mithaq upgrade --check and mithaq lock --check run without better-auth/db', async () => {
  await mithaq('upgrade', '--check')
  await mithaq('lock', '--check')
})

test('mithaq --help and -h print the usage outside a project, with no project to import', async () => {
  const outside = mkdtempSync(join(tmpdir(), 'mithaq-help-'))
  try {
    for (const flag of ['--help', '-h']) {
      const { stdout, stderr } = await run(process.execPath, [bin, flag], { cwd: outside })
      assert.match(stdout, /^Usage: mithaq generate auth/)
      assert.equal(stderr, '')
    }
  } finally {
    rmSync(outside, { recursive: true, force: true })
  }
})
