// Each case runs in a child process whose resolver refuses `better-auth/db`, so
// only `generate auth` may load Better Auth's schema reader.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

test('the bin loads a project whose sources import each other without an extension, as Vite, Bun and drizzle-kit do', async () => {
  const project = mkdtempSync(join(tmpdir(), 'mithaq-extensionless-'))
  try {
    mkdirSync(join(project, 'src/things'), { recursive: true })
    writeFileSync(join(project, 'package.json'), JSON.stringify({ type: 'module' }))
    writeFileSync(join(project, 'src/greeting.ts'), "export const greeting: string = 'hello'\n")
    writeFileSync(join(project, 'src/things/index.ts'), "export const things: string = 'things'\n")
    writeFileSync(join(project, 'src/asas.ts'), [
      "import { greeting } from './greeting'",
      "import { things } from './things'",
      'export const asas = { targets: { probe: { commands: { hello: async () => (console.log(`${greeting} ${things}`), 0) } } }, destroy: async () => {} }',
      '',
    ].join('\n'))
    const { stdout } = await run(process.execPath, [bin, 'probe', 'hello'], { cwd: project })
    assert.equal(stdout.trim(), 'hello things')
    // A specifier that names no file is still Node's own refusal.
    writeFileSync(join(project, 'src/asas.ts'), "import './nowhere'\n")
    await assert.rejects(run(process.execPath, [bin, 'probe', 'hello'], { cwd: project }), /ERR_MODULE_NOT_FOUND/)
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})

test('password-link needs an explicit database before importing the project', async () => {
  const outside = mkdtempSync(join(tmpdir(), 'mithaq-link-'))
  try {
    const env = { ...process.env }
    delete env.DATABASE_URL
    await assert.rejects(run(process.execPath, [bin, 'password-link', 'dummy@example.com'], { cwd: outside, env }), /Set DATABASE_URL explicitly/)
  } finally { rmSync(outside, { recursive: true, force: true }) }
})

test('jobs run needs an explicit database before importing the project', async () => {
  const outside = mkdtempSync(join(tmpdir(), 'mithaq-jobs-cli-'))
  try {
    const env = { ...process.env }
    delete env.DATABASE_URL
    await assert.rejects(run(process.execPath, [bin, 'jobs', 'run'], { cwd: outside, env }), /Set DATABASE_URL explicitly/)
  } finally { rmSync(outside, { recursive: true, force: true }) }
})

test('jobs run accepts positional queues, defaults to all task queues and refuses typos before running', async () => {
  const project = mkdtempSync(join(tmpdir(), 'mithaq-jobs-'))
  try {
    mkdirSync(join(project, 'src'))
    writeFileSync(join(project, 'package.json'), JSON.stringify({ type: 'module' }))
    writeFileSync(join(project, 'src/asas.ts'), `export const asas = {
      targets: {}, connect: async () => {}, destroy: async () => {},
      jobs: { queues: ['maintenance', 'mail'], run: async ({ queue }) => (console.log(queue), { failures: 0 }) }
    }`)
    const runJobs = (...queues: string[]) => run(process.execPath, [bin, 'jobs', 'run', ...queues], { cwd: project, env: { ...process.env, DATABASE_URL: 'postgres://unused@127.0.0.1:9/mithaq' } })
    assert.equal((await runJobs('mail')).stdout.trim(), 'mail')
    assert.equal((await runJobs()).stdout.trim(), 'maintenance\nmail')
    await assert.rejects(runJobs('mail', 'typo'), (error: any) => /typo/.test(error.stderr) && error.stdout === '')
    await assert.rejects(runJobs('--queue', 'mail'), /Usage: mithaq jobs run/)
  } finally { rmSync(project, { recursive: true, force: true }) }
})
