import type { ServiceTarget } from '../service/target.ts'

export const pageKeys = ['defaultLimit', 'maxLimit', 'joinLimit', 'bulkLimit'] as const

export const assertPageLimits = (service: Pick<ServiceTarget, typeof pageKeys[number]>) => {
  for (const key of pageKeys) {
    if (!Number.isInteger(service[key]) || service[key] < 1) throw new Error(`service.${key} must be a positive integer.`)
  }
  // A page the runner opens on its own may not exceed the most a caller may request.
  for (const key of ['defaultLimit', 'joinLimit'] as const) {
    if (service[key] > service.maxLimit) throw new Error(`service.${key} is ${service[key]}, past service.maxLimit ${service.maxLimit}.`)
  }
}
