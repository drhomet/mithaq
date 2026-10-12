// Each case runs in a child process whose resolver refuses `react`, so loading it is
// a failure and not a module this process already holds.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { test } from 'node:test'
import { promisify } from 'node:util'

const run = promisify(execFile)
const template = new URL('../../../../../templates/asas/', import.meta.url).pathname
const cli = (file: string) => new URL(file, import.meta.url).pathname
/** A resolve hook that refuses React by name, loaded before anything else. */
const noReact = `data:text/javascript,${encodeURIComponent(
  "import { registerHooks } from 'node:module'; registerHooks({ resolve(specifier, context, next) { if (specifier === 'react' || specifier.startsWith('react/')) throw new Error(`react was loaded from ${context.parentURL}`); return next(specifier, context) } })",
)}`
const node = (...args: string[]) => run(process.execPath, ['--import', noReact, ...args], { cwd: template, env: { ...process.env } })

test('the refusal is real: importing the hooks entry fails where React cannot resolve', async () => {
  await assert.rejects(node('--input-type=module', '-e', "await import('mithaq/admin/react')"), /react was loaded/)
})

test('mithaq/admin and every CLI entry load without React', async () => {
  const entries = ['mithaq/admin', cli('./mithaq.ts'), cli('../../auth/better-auth/generate.ts'), cli('../../screen/generate.ts'), cli('../../mithaq/generate-messages.ts'), cli('./upgrade.ts')]
  await node('--input-type=module', '-e', entries.map((entry) => `await import(${JSON.stringify(entry)})`).join(';'))
})

test('mithaq screens and mithaq generate screens --check run without React', async () => {
  const { stdout } = await node(cli('./mithaq.ts'), 'screens')
  assert.match(stdout, /^screen dashboard \/dashboard/m)
  await node(cli('./mithaq.ts'), 'generate', 'screens', '--check')
})
