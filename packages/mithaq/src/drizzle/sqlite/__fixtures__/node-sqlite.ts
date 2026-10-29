import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import type { SqliteContract } from '../index.ts'
type SqliteValue = string | number | boolean | null

export const nodeSqlite = (path = ':memory:') => {
  const sqlite = new DatabaseSync(path)
  /** Every statement in the order SQLite ran it. */
  const log: string[] = []
  let tail: Promise<unknown> = Promise.resolve()
  // The native module serialises every call per database, so a call made while a transaction
  // is open waits behind it, and one made from inside it waits behind itself.
  const serial = <T>(work: () => T | Promise<T>): Promise<T> => {
    const ran = tail.then(work)
    tail = ran.catch(() => {})
    return ran
  }
  const run = (sql: string, params: readonly SqliteValue[] = []) => {
    log.push(sql)
    const statement = sqlite.prepare(sql)
    // SQLite has no boolean; the native module binds one as 1 or 0.
    const values = params.map((value) => (typeof value === 'boolean' ? Number(value) : value)) as SQLInputValue[]
    if (!statement.columns().length) {
      const { changes, lastInsertRowid } = statement.run(...values)
      return { rows: [] as SqliteValue[][], columns: [] as string[], changes: Number(changes), lastInsertRowId: Number(lastInsertRowid) }
    }
    statement.setReturnArrays(true)
    const rows = statement.all(...values) as unknown as SqliteValue[][]
    return { rows, columns: statement.columns().map((column) => column.name), changes: 0, lastInsertRowId: 0 }
  }
  const atomic = async <T>(work: () => Promise<T> | T) => {
    run('begin')
    try {
      const result = await work()
      run('commit')
      return result
    } catch (error) {
      run('rollback')
      throw error
    }
  }
  const over = (execute: (sql: string, params: SqliteValue[]) => Promise<{ rows: SqliteValue[][] }>) => drizzle(async (query, params, method) => {
    const { rows } = await execute(query, params)
    return { rows: method === 'get' ? rows[0] as never : rows }
  })
  const database: SqliteContract = {
    db: over(async (query, params) => serial(() => run(query, params))),
    transaction: (work) => serial(() => atomic(() => work(over(async (query, params) => run(query, params))))),
  }
  return { database, sqlite, log }
}
