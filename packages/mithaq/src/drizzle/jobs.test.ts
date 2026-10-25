import { jobsContract } from '../jobs/contract.ts'
import { drizzleJobs } from './jobs.ts'
import { drizzleAdapter } from './index.ts'
import { drizzleIdKinds, drizzleKinds, drizzleRules } from '../targets.ts'
import { testDatabase } from '../../../../templates/asas/src/test-database.ts'

jobsContract(async () => {
  const adapter = drizzleAdapter({ connectionString: testDatabase(), kinds: drizzleKinds, rules: drizzleRules, idKinds: drizzleIdKinds })
  const store = adapter.init([], { jobs: true }) as typeof adapter
  await store.connect()
  await store.db.execute('truncate mithaq_jobs')
  return { driver: drizzleJobs({ lease: 30000, retain: { completed: 1000, failed: 1000 } }).driver.init(store), peer: drizzleJobs({ lease: 30000, retain: { completed: 1000, failed: 1000 } }).driver.init(store), transaction: store.transaction, destroy: store.destroy }
})
