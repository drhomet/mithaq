import { spawn, spawnSync } from 'node:child_process'
import { globSync } from 'node:fs'
import { freemem, totalmem } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const testWorkers = ({ freePercent, override }: { freePercent: number | undefined; override?: string }) => {
  if (override !== undefined) {
    if (!/^[1-9]\d*$/.test(override) || !Number.isSafeInteger(Number(override))) throw new Error('--workers needs a positive integer.')
    return Number(override)
  }
  return freePercent !== undefined && freePercent >= 50 ? 2 : 1
}

const memoryFree = () => {
  if (process.platform !== 'darwin') return freemem() / totalmem() * 100
  const result = spawnSync('memory_pressure', { encoding: 'utf8' })
  const match = result.stdout?.match(/System-wide memory free percentage: (\d+)%/)
  return match ? Number(match[1]) : undefined
}

const main = async () => {
  const args = process.argv.slice(2).filter((arg) => arg !== '--')
  const unit = args.includes('--unit')
  const workerArg = args.find((arg) => arg.startsWith('--workers='))
  const workerIndex = args.indexOf('--workers')
  const override = workerArg?.slice('--workers='.length) ?? (workerIndex >= 0 ? args[workerIndex + 1] ?? '' : undefined)
  const workers = testWorkers({ freePercent: memoryFree(), override })
  const paths = args.filter((arg, index) => arg !== '--unit' && !arg.startsWith('--workers=') && arg !== '--workers' && index !== (workerIndex >= 0 ? workerIndex + 1 : -1))
  const files = paths.length ? paths : unit
    ? [
      ...['packages/**/*.test.ts', 'apps/**/*.test.ts'].flatMap((pattern) => globSync(pattern)).filter((file) => file !== 'packages/mithaq-admin/test/payload-password.test.ts'),
      ...['access', 'arkan', 'database-url', 'drizzle-proxy', 'kayan-layouts', 'lock', 'rich-text-threads', 'screens', 'tenant-target', 'test-database'].map((name) => `templates/asas/src/${name}.test.ts`),
      'templates/asas/src/ui-dashboard/members.test.ts',
    ]
    : ['packages/**/*.test.ts', 'templates/**/*.test.ts', 'apps/**/*.test.ts']
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // Unit imports build declarations, but a connection attempt must fail instead of reaching a real database.
    ...(unit ? Object.fromEntries(['DATABASE_URL', 'DATABASE_URI', 'DATABASE_URI_V2', 'POSTGRES_URL'].map((key) => [key, 'postgres://postgres:postgres@127.0.0.1:1/mithaq'])) : {}),
    RESEND_API_KEY: 're_test_never_sent', MAIL_FROM: 'tests@example.com', RESEND_BASE_URL: 'http://127.0.0.1:9',
    LOCAL_AUTH_SECRET: 'asas-local-auth-test-secret-of-32-characters',
  }
  const run = (argv: string[]) => new Promise<number>((accept, reject) => {
    const child = spawn(process.execPath, argv, { env, stdio: 'inherit' })
    const interrupt = () => child.kill('SIGINT')
    const terminate = () => child.kill('SIGTERM')
    process.once('SIGINT', interrupt)
    process.once('SIGTERM', terminate)
    child.once('error', reject)
    child.once('close', (code) => {
      process.removeListener('SIGINT', interrupt)
      process.removeListener('SIGTERM', terminate)
      accept(code ?? 1)
    })
  })
  if (!unit && !paths.length) {
    for (const file of ['apps/lint-args.ts', 'apps/test-setup.ts']) {
      const code = await run([file])
      if (code) return code
    }
  }
  console.log(`Test workers: ${workers}`)
  return await run(['--test', `--test-concurrency=${workers}`, ...files])
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = await main()
}
