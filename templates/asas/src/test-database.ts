// Test support: the one database a test may drop, push, migrate and fill.
import { devDatabaseUrl } from '../../mithaq/src/mithaq.ts'

/**
 * The URL in DATABASE_URL, answered only when a person named it for this run.
 * The language falls back to the dev database when the variable is unset, which
 * is right for `vite dev` and wrong for a test. So every test step that drops a
 * schema, pushes one or writes rows calls this before its first statement, and
 * it refuses an unset URL, protected ports and any database not called `mithaq`,
 * which is what a throwaway test container is created as, so a DATABASE_URL left
 * exported for some other database is refused too.
 */
export const testDatabase = (env: Readonly<Record<string, string | undefined>> = process.env) => {
  const url = env.DATABASE_URL
  if (!url) {
    throw new Error(
      'Refusing to touch a database: set DATABASE_URL to a throwaway database named "mithaq" for this test run. A test never falls back to the dev database.',
    )
  }
  // pg reads `?port=` over the URL's own port, and of a repeated one the last.
  // No port is PostgreSQL's default, 5432, the port `devDatabaseUrl` names.
  // pg connects to `parseInt(port, 10)`, so `055480` and `+55480` are 55480 too.
  const { port: named, pathname, searchParams } = new URL(url)
  const port = Number.parseInt(searchParams.getAll('port').at(-1) || named || '5432', 10)
  if ([Number(new URL(devDatabaseUrl).port), 55439, 55480, 5432, 5433, 5173, 5174, 5320, 55620].includes(port)) {
    throw new Error(
      `Refusing to touch a database: DATABASE_URL names port ${port}, which is protected. Point it at a throwaway database.`,
    )
  }
  const database = decodeURIComponent(pathname.slice(1))
  if (database !== 'mithaq') {
    throw new Error(
      `Refusing to touch a database: DATABASE_URL names the database "${database}", and a test only runs against a throwaway one named "mithaq".`,
    )
  }
  return url
}
