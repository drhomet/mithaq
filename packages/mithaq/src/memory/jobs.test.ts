import { jobsContract } from '../jobs/contract.ts'
import { memoryJobs, memoryTransactions } from './jobs.ts'

jobsContract(async () => {
  const store = memoryTransactions()
  return { driver: memoryJobs({ lease: 30000, retain: { completed: 1000, failed: 1000 } }).driver.init(store), peer: memoryJobs({ lease: 30000, retain: { completed: 1000, failed: 1000 } }).driver.init(store), transaction: store.transaction, destroy: async () => {} }
})
