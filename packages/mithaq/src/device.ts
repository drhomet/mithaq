import { defineMithaqWith, type CheckedLanguage, type Composed, type Defined, type Language } from './mithaq/language-core.ts'
import { buildDeviceAsas, type DeviceAsas } from './asas/runner/device.ts'
import type { buildAsas } from './asas/build.ts'
import type { Kayan } from './mithaq/types.ts'

export type DeviceDefined<L extends Language> = Omit<Defined<L>, 'buildAsas'> & {
  buildAsas<const K extends readonly Kayan[], const G extends readonly Kayan[] = readonly []>(args: { kayan: K; global?: G; http: readonly [] }): DeviceAsas<L, K, G>
}

/** A project's device language has its own target vocabulary and lock. */
export const defineMithaq = <const L>(language: L & CheckedLanguage<L>): DeviceDefined<Extract<Composed<L>, Language>> =>
  defineMithaqWith<L>({ language, build: buildDeviceAsas as unknown as typeof buildAsas }) as unknown as DeviceDefined<Extract<Composed<L>, Language>>

export { base } from './base/index.ts'
export { defaultFields, defaultGlobalFields, defaultIdField, defaultTimestampFields } from './base/fields.ts'
export { defaultAuthorize } from './asas/runner/access.ts'
export { serviceTarget, defaultBulkLimit, defaultDepth, defaultJoinLimit, defaultLimit, defaultMaxLimit } from './service/target.ts'
export { sqliteAdapter, type SqliteAdapter, type SqliteContract, type SqliteDatabase } from './drizzle/sqlite/index.ts'
export { kinds as drizzleSqliteKinds, idKinds as drizzleSqliteIdKinds } from './drizzle/sqlite/kinds.ts'
export { rules as drizzleSqliteRules } from './drizzle/sqlite/rules.ts'
export { migrateSqlite, type SqliteMigration } from './drizzle/sqlite/migrate.ts'
export { zodTarget } from './zod/index.ts'
export { kinds as zodKinds, idKinds as zodIdKinds } from './zod/kinds.ts'
export { rules as zodRules } from './zod/rules.ts'
export { defaultOperations, defaultGlobalOperations, defaults, insert, update, remove, find, findOne, count, updateMany, deleteMany, audit, type ProjectStep, type Ctx } from './asas/runner/steps.ts'
export { defineRukn } from './mithaq/rukn.ts'
export { accessFor, fieldAccessFor } from './mithaq/types.ts'
export { AsasError, AfterCommitError, denied, invalid, missing, conflict } from './asas/runner/errors.ts'
export type { Kayan, ResolvedKayan } from './mithaq/types.ts'
export type { Where } from './mithaq/where.ts'
