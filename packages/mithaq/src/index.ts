// `rows` itself is not exported: the compiler an app reaches is the one `defineMithaq`
// hands back, whose role keys are checked against the access target's system roles.
export type { AccessRow, CheckedTable, FieldList, Held, RowFieldWhere, RowOperation, RowTable, RowWhere, Rows, RowsOptions } from './mithaq/rows.ts'
export { userRefs, type Ref, type UserRefs } from './mithaq/user.ts'
export { betterAuth, betterAuthStrategy } from './auth/better-auth/index.ts'
export { defaultLockTime, defaultMaxLoginAttempts, defaultTokenExpiration, local, localAuthFields, localAuthOperations, localAuthStrategy } from './auth/local/index.ts'
export { actorPermissions, actorRoles, authActor } from './asas/actor.ts'
export { assignableRole, grantedPermissions, writableRoleName } from './rbac/steps.ts'
export * from './targets.ts'
export { heldPermissions, type Assigned, type CommandActor } from './rbac/index.ts'
export { holdsPermission, requestOrganization } from './auth/better-auth/index.ts'
export type { AssignedResolver, AuthStrategy, KayanAuth } from './asas/actor.ts'
export type { AuthConfig, HttpPlug, Operation, OperationTable, Vocabulary } from './asas/build.ts'
export { defaultMaxBodyBytes, fetchHttp, type FetchHttpOptions } from './asas/http/fetch.ts'
export { AfterCommitError, AsasError, conflict, denied, invalid, missing, retryConflict, Notice, type MessageKey } from './asas/runner/errors.ts'
export {
  audit,
  count,
  defaultOperations,
  defaultGlobalOperations,
  defaults,
  find,
  findOne,
  findVersionByID,
  findVersions,
  insert,
  remove,
  restoreVersion,
  update,
  updateMany,
  deleteMany,
  validate,
  type BulkResult,
  type Context,
  type CommonStep,
  type CommonTools,
  type ContextOf,
  type Ctx,
  type CtxOf,
  type AuditHandler,
  type Derives,
  type FieldsOf,
  type DerivedSchemas,
  type DerivedShapes,
  type SchemasOf,
  type Lists,
  type OperationDeclaration,
  type OperationEffect,
  type OperationStep,
  type OperationSteps,
  type ProjectStep,
  type SlotSteps,
  type Operations,
  type OperationDefaults,
  type ReadMode,
  type ReadStep,
  type ReadTools,
  type ResolvedOperation,
  type Sealed,
  type Step,
  type StepsOf,
  type Tools,
  type WriteStep,
  type WriteTools,
} from './asas/runner/steps.ts'
export type { Authorize, BoundKayans, ByID, CreateOf, Globals, IdOf, Options, Procedures, ReadOptions, Row, RowOf, UpdateOf, Version, Writes } from './asas/runner/write.ts'
export type { Where } from './mithaq/where.ts'
export { defaultFields, defaultGlobalFields, defaultIdField, defaultTimestampFields } from './base/fields.ts'
export { uploadFields, uploadedByField } from './storage/storage.ts'
export { accessFor, fieldAccessFor } from './mithaq/types.ts'
export type { Access, AccessArgs, AccessResult, AdminAccess, AdminAccessArgs, CompoundIndex, FieldAccess, FieldAccessArgs, Field, FilterOptions, JsonSchema, Kayan, KayanService, LabelFunction, Localized, LocalesOf, MessageMap, MessageTree, ResolvedField, ResolvedKayan, RuntimeField } from './mithaq/types.ts'
export type { Copy, MessageRegistry, MessageScope, MessagesResolver, ProjectMessages } from './mithaq/messages.ts'
export { defaultJsonMaxBytes, defaultKinds, isJson, kind, type Json, type Kind, type OnDelete } from './base/kinds.ts'
export { jsonSchemaCheck } from './base/json-schema.ts'
export type { RichTextNode, RichTextValue } from '@drhomet/mithaq-rich-text/value'
export { defineRukn, type KayanConfigs, type Rukn } from './mithaq/rukn.ts'
export { base } from './base/index.ts'
export { storage, upload } from './storage/index.ts'
export { versions } from './versions/index.ts'
export { defineMithaq, isJobs, isAccess, isScreen, isService, isStorage, isStore, isTenant, isVersions, type Command, type CommandInput, type Language, type SchemaTarget, type Store, type Target, type TenantField, type TenantTarget } from './mithaq/language.ts'
export { Refusal } from './mithaq/refusal.ts'
export { defaultRules, providerOf, rule, type ProvidedBy, type Provider, type Rule, type Rules, type RuleValue } from './base/rules.ts'
export { draftFields, versionOperations } from './versions/versions.ts'
export {
  cleanupUploads,
  sweepStorage,
  adapterOf,
  allowedType,
  checkReference,
  fileHeaders,
  readForFile,
  sanitizeFilename,
  signReference,
  withUploadReference,
  type KayanStorage,
  type StorageAdapter,
  type StorageKayan,
  type StorageStep,
  type StoredFile,
  type SweepArgs,
  type UploadInstructions,
  type UploadReference,
  type UploadRequest,
  type Verified,
  type VerifyArgs,
} from './storage/storage.ts'
export {
  folderOf,
  type ScreenKind,
  type ScreenButton,
  type ScreenFrame,
  type ScreenLayout,
  type ScreenOwnPage,
  type ScreenNav,
  type ScreenRegions,
  type Ui,
  type ScreenField,
  type ScreenKayan,
  type ScreenLeaf,
  type ScreenNode,
  type ScreenPage,
  type ScreenRef,
} from './screen/index.ts'
export type { InferInput, InferOutput, StandardSchemaV1 } from './mithaq/standard-schema.ts'

export { defaultJobLease, defaultJobRetention, type JobTask, type JobTasks } from './jobs/config.ts'

export { drizzleJobs } from './drizzle/jobs.ts'
export { memoryJobs, memoryTransactions } from './memory/jobs.ts'
export type { Job, JobPolicy, JobRetention, JobFinish, JobsDriver, JobsTarget } from './jobs/driver.ts'
