import {
  base, defaultAuthorize, defaultBulkLimit, defaultDepth, defaultFields,
  defaultJoinLimit, defaultLimit, defaultMaxLimit, defaultOperations, defineMithaq,
  drizzleSqliteIdKinds, drizzleSqliteKinds, drizzleSqliteRules, serviceTarget,
  sqliteAdapter, zodIdKinds, zodKinds, zodRules, zodTarget, type SqliteContract,
} from '../../../device.ts'

export const deviceLanguage = ({ db, transaction }: SqliteContract) => defineMithaq({
  locales: ['en', 'ar'],
  arkan: [base],
  targets: {
    sqlite: sqliteAdapter({ db, transaction, kinds: drizzleSqliteKinds, rules: drizzleSqliteRules, idKinds: drizzleSqliteIdKinds }),
    zod: zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }),
    service: serviceTarget({
      store: 'sqlite', schema: 'zod', authorize: defaultAuthorize, depth: defaultDepth,
      defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit,
    }),
  },
})

export const deviceAsas = (contract: SqliteContract) => {
  const { defineKayan, buildAsas } = deviceLanguage(contract)
  const patient = defineKayan({
    name: 'patient',
    placement: 'device',
    fields: { ...defaultFields, name: { kind: 'text', rules: { required: true } } },
    access: { create: () => true, read: () => true, update: () => true, delete: () => true },
    targets: { service: { operations: defaultOperations } },
  })
  return buildAsas({ kayan: [patient], http: [] })
}
