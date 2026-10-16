import { setTimeout as delay } from 'node:timers/promises'

/** Bound gates as well as assertions: node:test's timeout does not release a held transaction. */
export const within = async <T>(promise: Promise<T>, ms = 2000): Promise<T> => {
  let timer: ReturnType<typeof setTimeout>
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Timed out waiting for the test transaction.')), ms) })])
  } finally {
    clearTimeout(timer!)
  }
}

/** A parallel file's lock wait must never release this test's gate. */
export const blocked = async ({ db, where, count = 1, finished = () => false }: {
  db: { execute(query: string): Promise<{ rows: unknown[] }> }
  where: string | (() => string)
  count?: number
  finished?: () => boolean
}) => {
  for (let tries = 0; tries < 200 && !finished(); tries += 1) {
    const { rows } = await within(db.execute(`select 1 from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and (${typeof where === 'function' ? where() : where})`))
    if (rows.length >= count) return 'waited'
    await delay(10)
  }
  return 'timed out'
}
