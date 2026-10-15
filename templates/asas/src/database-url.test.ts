// Every CLI command that would otherwise open a real connection refuses first
// when nobody named a database, naming DATABASE_URL, rather than silently
// reaching the dev database. Each step runs the real bin against this real
// project with DATABASE_URL removed from the child's environment: the refusal
// runs before any drizzle call, so none of these ever opens a socket.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { formatLock, sealLanguage, vocabularyOf } from '../../../packages/mithaq/src/mithaq/lock.ts'
import { receivedLanguage } from '../../../packages/mithaq/src/mithaq/language.ts'
import { defineKayan, devDatabaseUrl } from '../../mithaq/src/mithaq.ts'

const bin = new URL('../../../packages/mithaq/src/asas/cli/mithaq.ts', import.meta.url)
/** This project's own root, which holds `src/asas.ts` the bin imports. */
const project = new URL('../', import.meta.url)

const run = (argv: string[], cwd = project) =>
  new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    // A person's shell, which carries no test runner's context either.
    const env = { ...process.env }
    delete env.DATABASE_URL
    delete env.NODE_TEST_CONTEXT
    const child = execFile(process.execPath, [fileURLToPath(bin), ...argv], { cwd: fileURLToPath(cwd), env })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk
    })
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })

test('`mithaq migrate` with no DATABASE_URL refuses before opening a connection', async () => {
  const { code, stderr } = await run(['migrate'])
  assert.notEqual(code, 0)
  assert.match(stderr, /set DATABASE_URL/)
})

test('`mithaq migrate --check` with no DATABASE_URL refuses before opening a connection, read-only or not', async () => {
  const { code, stderr } = await run(['migrate', '--check'])
  assert.notEqual(code, 0)
  assert.match(stderr, /set DATABASE_URL/)
})

test('`mithaq rbac assign` with no DATABASE_URL refuses before opening a connection', async () => {
  const { code, stderr } = await run(['rbac', 'assign', '--tenant', 'org', '--user', 'person', '--role', 'administrator'])
  assert.notEqual(code, 0)
  assert.match(stderr, /set DATABASE_URL/)
})

test('`mithaq storage sweep` with no DATABASE_URL refuses before opening a connection, though its target is the storage rukn\'s', async () => {
  const { code, stderr } = await run(['storage', 'sweep', '--check'])
  assert.notEqual(code, 0)
  assert.match(stderr, /set DATABASE_URL/)
})

test('`mithaq rbac assign --check` with no DATABASE_URL still writes nothing and needs no variable', async () => {
  const { code, stdout } = await run(['rbac', 'assign', '--check'])
  assert.equal(code, 0)
  assert.match(stdout, /writes nothing/)
})

test('the `generate --check` sweep with no DATABASE_URL refuses before opening a connection', async () => {
  // The template's lock may be pending, red or signed, and the sweep checks it
  // first, so the sweep runs here from a stand-in root beside a lock a test key
  // signed over this very language: this project's own `src`, `package.json` and
  // `node_modules`, linked, and the `features` beside it and an `apps` two levels
  // up, linked too, so every `generate` path resolves where it does from the template. Nothing writes the
  // template's own lock, which another test file may be reading.
  const wrap = await mkdtemp(join(tmpdir(), 'mithaq-sweep-'))
  const root = pathToFileURL(`${wrap}/templates/asas/`)
  try {
    await mkdir(root, { recursive: true })
    await symlink(fileURLToPath(new URL('../../apps/', project)), join(wrap, 'apps'))
    await symlink(fileURLToPath(new URL('../features/', project)), join(wrap, 'templates/features'))
    for (const name of ['src', 'package.json', 'node_modules']) await symlink(fileURLToPath(new URL(name, project)), fileURLToPath(new URL(name, root)))
    const language = vocabularyOf(receivedLanguage(defineKayan))
    await writeFile(new URL('mithaq.lock', root), formatLock(sealLanguage({ language, key: generateKeyPairSync('ed25519').privateKey })))
    const { code, stderr } = await run(['generate', '--check'], root)
    assert.notEqual(code, 0)
    assert.doesNotMatch(stderr, /mithaq lock --check` answered/, 'the signed lock lets the sweep on')
    assert.match(stderr, /set DATABASE_URL/)
  } finally {
    await rm(wrap, { recursive: true, force: true })
  }
})

test('with no DATABASE_URL the drizzle target still resolves the dev database connection string, which is what lets `vite dev` start with no variable set', async () => {
  // Read, never connected to: `drizzle()` opens no socket building the instance
  // (`node-postgres` opens none until the first query), so asserting the resolved
  // string proves what a served request would use without ever reaching a port.
  const { code, stdout, stderr } = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const env = { ...process.env }
    delete env.DATABASE_URL
    delete env.NODE_TEST_CONTEXT
    const child = execFile(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "const { serverTargets, devDatabaseUrl } = await import('../../mithaq/src/mithaq.ts'); console.log(serverTargets.drizzle.connectionString === devDatabaseUrl ? 'ok' : 'mismatch: ' + serverTargets.drizzle.connectionString)",
      ],
      { cwd: fileURLToPath(new URL('.', import.meta.url)), env },
    )
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk
    })
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
  assert.equal(code, 0, stderr)
  assert.match(stdout, /^ok/)
})

test('a production boot with no DATABASE_URL refuses on import, before any connection, rather than falling back to the dev database and its password', async () => {
  // The same import `vite dev` makes, with NODE_ENV set the way a production
  // start sets it and everything else such a start needs named, so the only
  // thing missing is the database. The language lays down the storage rukn over
  // the project's own config, so the storage settings are among them.
  const { code, stdout, stderr } = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: 'production',
      BETTER_AUTH_SECRET: 'a-production-secret',
      BACKOFFICE_URL: 'https://backoffice.example.com',
      BETTER_AUTH_URL: 'https://app.example.com',
      STORAGE_SECRET: 'a-production-storage-secret-of-32-characters',
      STORAGE_PREFIX: 'mithaq/asas',
      STORAGE_ADAPTER: 'local',
      // Nothing here mails, and the discard port refuses what would.
      RESEND_API_KEY: 're_never_sent',
      MAIL_FROM: 'mail@example.com',
      RESEND_BASE_URL: 'http://127.0.0.1:9',
    }
    delete env.DATABASE_URL
    const child = execFile(
      process.execPath,
      ['--input-type=module', '-e', "const { serverTargets } = await import('../../mithaq/src/mithaq.ts'); console.log(serverTargets.drizzle.connectionString)"],
      { cwd: fileURLToPath(new URL('.', import.meta.url)), env },
    )
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk
    })
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
  assert.notEqual(code, 0, stdout)
  assert.match(stderr, /A production boot needs DATABASE_URL/)
  assert.ok(!stdout.includes(devDatabaseUrl), 'the dev database was never resolved')
})

test('under node --test, an import with no DATABASE_URL refuses before any connection, rather than falling back to the dev database', async () => {
  // The context `node --test` puts on each test file's process, and so on
  // every child it starts that inherits its environment. The import throws, so
  // no pool is built and the dev database is never named in what the child printed.
  const { code, stdout, stderr } = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const env: NodeJS.ProcessEnv = { ...process.env, NODE_TEST_CONTEXT: 'child' }
    delete env.DATABASE_URL
    const child = execFile(
      process.execPath,
      ['--input-type=module', '-e', "const { serverTargets } = await import('../../mithaq/src/mithaq.ts'); console.log(serverTargets.drizzle.connectionString)"],
      { cwd: fileURLToPath(new URL('.', import.meta.url)), env },
    )
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk
    })
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
  assert.notEqual(code, 0, stdout)
  assert.match(stderr, /A test run needs DATABASE_URL/)
  assert.match(stderr, /set DATABASE_URL/)
  assert.ok(!stdout.includes(devDatabaseUrl), 'the dev database was never resolved')
})
