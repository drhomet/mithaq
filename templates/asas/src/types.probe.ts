// The claims the language makes about types, checked by the typecheck script.
// Every `@ts-expect-error` line fails the build the day it stops being an error.
import type { InferSelectModel } from 'mithaq/drizzle'
import { text as textColumn } from 'mithaq/drizzle/pg-core'
import { z } from 'zod'
import {
  screenKinds,
  betterAuth,
  betterAuthTenant,
  local,
  defaultLockTime,
  defaultMaxLoginAttempts,
  defaultTokenExpiration,
  audit,
  defaultFields,
  defaultKinds,
  defaultRules,
  defaultOperations,
  defaultAuthorize,
  defaultDepth,
  defaultLimit,
  defaultMaxLimit,
  defaultJoinLimit,
  defaultBulkLimit,
  base,
  defineMithaq,
  defineRukn,
  drizzleAdapter,
  drizzleKinds,
  drizzleRules,
  kind,
  storage,
  versions,
  versionsTarget,
  localAuthStrategy,
  rbacTarget,
  defaults,
  insert,
  findOne,
  validate,
  accessFor,
  fieldAccessFor,
  userRefs,
  zodTarget,
  zodKinds,
  zodRules,
  type AuditHandler,
  type CommandActor,
  type Step,
  type CreateOf,
  type RowOf,
  draftFields,
  versionOperations,
  type RuleValue,
  type UpdateOf,
  type ZodRule,
  type AccessArgs,
  type AdminAccessArgs,
  type FieldAccess,
  type FieldAccessArgs,
  type DerivedSchemas,
  type Row,
  type ResolvedKayan,
  type ResolvedField,
  type RuntimeField,
  type CommonTools,
  type Ctx,
  type CtxOf,
  type InferInput,
  type InferOutput,
  type ReadStep,
  type WriteStep,
  type WriteTools,
  type ReadTools,
  type BoundKayans,
  type Procedures as OperationProcedures,
  type LocalesOf,
  type Localized,
  type StandardSchemaV1,
  type Where,
  type TenantField,
  serviceTarget,
  folderOf,
  screenTarget,
  defaultGlobalFields,
  defaultGlobalOperations,
  fetchHttp,
} from 'mithaq'
import type { CompoundIndex } from 'mithaq'
import { richText } from 'mithaq/rich-text'
import type { RouterClient } from '@orpc/server'
import type { FetchClient } from 'mithaq/admin'
import { asas } from './asas.ts'
import { type OrganizationActor } from '../../mithaq/src/roles/tenant-access.ts'
import { systemRoles } from '../../mithaq/src/roles/system-roles.ts'
import { courses } from '../../features/courses/courses/courses.ts'
import { sessions } from '../../features/courses/sessions/sessions.ts'
import { localUsers } from '../../features/auth/local-users/local-users.ts'
import { settings } from '../../features/settings/settings/settings.ts'
import { user } from '../../features/auth/user/user.ts'
import { buildAsas, defineGlobal, defineKayan, generate, rows, tenant, user as actor } from '../../mithaq/src/mithaq.ts'
import { memoryStore } from './memory-store.ts'
import { plainTarget } from './standard-schema-target.ts'
import { richTextNodes } from '../../mithaq/src/mithaq/rich-text-nodes.ts'
// @ts-expect-error mithaq exports no storageOperations: a kayan holding files declares its own create and delete
import { storageOperations } from 'mithaq'
void storageOperations
import { storageConfig } from '../../mithaq/src/storage/index.ts'

type Expect<T extends true> = T
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

type Tenant = Expect<Equal<(typeof courses)['fields']['organization']['kind'], 'relationship'>>
type TenantBound = Expect<Equal<(typeof courses)['fields']['organization']['targets']['tenant'], true>>
type CreatedAt = Expect<Equal<(typeof courses)['fields']['createdAt']['kind'], 'datetime'>>

// @ts-expect-error the auth kayan are shared and place no tenant field
type NoTenant = (typeof user)['fields']['organization']

defineKayan({
  name: 'defaultFieldsKeyProbe',
  // @ts-expect-error a kayan has no `defaultFields` key: spread `defaultFields` into `fields` instead
  defaultFields: { tenant: false },
  fields: { title: { kind: 'text', label: { en: 'Title', ar: 'العنوان' } } },
  targets: { service: { operations: defaultOperations } },
})

// `fields` and `operations` written over what the language offers. The defaults are exactly the
// id and timestamps, and the shipped operations, plus versions' own for a kayan that keeps them.
const title = { kind: 'text', label: { en: 'Title', ar: 'العنوان' } } as const
const overDefaults = defineKayan({
  name: 'overDefaults',
  fields: ({ defaults }) => ({ ...defaults, title }),
  targets: { service: { operations: ({ defaults }) => ({ ...defaults, archive: { steps: ({ steps }) => [steps.update] } }) } },
})
type OverDefaultsFields = Expect<Equal<keyof (typeof overDefaults)['fields'], 'id' | 'updatedAt' | 'createdAt' | 'title'>>
type OverDefaultsRow = Expect<Equal<RowOf<(typeof overDefaults)['fields'], 'zod'>['title'], string | null>>
type OverDefaultsCreate = Expect<Equal<'title' extends keyof CreateOf<(typeof overDefaults)['fields'], 'zod'> ? true : false, true>>
type OverDefaultsOperations = Expect<Equal<keyof (typeof overDefaults)['targets']['service']['operations'], keyof typeof defaultOperations | 'archive'>>
defineKayan({
  name: 'plainDefaults',
  fields: ({ defaults }) => {
    type Exact = Expect<Equal<typeof defaults, typeof defaultFields>>
    return defaults
  },
  targets: {
    service: {
      operations: ({ defaults }) => {
        type Exact = Expect<Equal<typeof defaults, typeof defaultOperations>>
        return defaults
      },
    },
  },
})
defineKayan({
  name: 'draftDefaults',
  fields: ({ defaults }) => {
    type Drafts = Expect<Equal<typeof defaults, typeof defaultFields & typeof draftFields>>
    return defaults
  },
  targets: {
    versions: { drafts: true },
    service: {
      operations: ({ defaults }) => {
        type Versions = Expect<Equal<typeof defaults, typeof defaultOperations & typeof versionOperations>>
        return defaults
      },
    },
  },
})
defineKayan({
  name: 'overDefaultsStrayKey',
  // @ts-expect-error `lengthy` is no key of any kind, in the function form as in the object
  fields: ({ defaults }) => ({ ...defaults, title: { ...title, lengthy: 3 } }),
})
defineKayan({
  name: 'overDefaultsStrayTarget',
  // @ts-expect-error a field's entry under a screen is typed by that screen: a column is unsortable or nothing
  fields: ({ defaults }) => ({ ...defaults, title: { ...title, targets: { dashboard: { sortable: true } } } }),
})
defineKayan({
  name: 'overDefaultsStrayOperationKey',
  fields: ({ defaults }) => defaults,
  targets: {
    service: {
      // @ts-expect-error `bogus` is no key of an operation declaration, in a returned object too
      operations: ({ defaults }) => ({ ...defaults, archive: { steps: ({ steps }) => [steps.update], bogus: 1 } }),
    },
  },
})
// @ts-expect-error the defaults are the language's, and hold no field the kayan did not ask for
defineKayan({ name: 'noDrafts', fields: ({ defaults }) => ({ ...defaults, status: defaults._status }) })

defineKayan({
  name: 'indexesProbe',
  fields: { code: { kind: 'text', label: { en: 'Code', ar: 'الرمز' } } },
  // @ts-expect-error "cod" is no field of this kayan
  indexes: [{ fields: ['code', 'cod'] }],
  targets: { service: { operations: defaultOperations } },
})
defineKayan({
  name: 'nullsProbe',
  fields: { code: { kind: 'text', label: { en: 'Code', ar: 'الرمز' } } },
  // @ts-expect-error nullsNotDistinct without unique: true
  indexes: [{ fields: ['code'], nullsNotDistinct: true }],
  targets: { service: { operations: defaultOperations } },
})
defineKayan({
  name: 'nullsProbe',
  fields: { code: { kind: 'text', label: { en: 'Code', ar: 'الرمز' } } },
  indexes: [{ fields: ['code'], unique: true, nullsNotDistinct: true }],
  targets: { service: { operations: defaultOperations } },
})
// A function of the defaults answers the whole list; the defaults are typed by the kayan's own fields.
defineKayan({
  name: 'indexesFunctionProbe',
  fields: { code: { kind: 'text', label: { en: 'Code', ar: 'الرمز' }, rules: { unique: true } }, title: { kind: 'text', label: { en: 'Title', ar: 'العنوان' } } },
  indexes: ({ defaults }) => {
    type Defaults = Expect<Equal<typeof defaults, CompoundIndex<'code' | 'title'>[]>>
    return [...defaults.filter((index) => !(index.unique && index.fields.includes('code'))), { fields: ['code'], unique: true }]
  },
  targets: { service: { operations: defaultOperations } },
})
defineKayan({
  name: 'indexesFunctionProbe',
  fields: { code: { kind: 'text', label: { en: 'Code', ar: 'الرمز' } } },
  // @ts-expect-error "cod" is no field of this kayan
  indexes: ({ defaults }) => [...defaults, { fields: ['cod'] }],
  targets: { service: { operations: defaultOperations } },
})
defineKayan({
  name: 'indexesFunctionProbe',
  fields: { code: { kind: 'text', label: { en: 'Code', ar: 'الرمز' } } },
  // @ts-expect-error the function answers a list of indexes
  indexes: () => ({ fields: ['code'] }),
  targets: { service: { operations: defaultOperations } },
})

// A group is within the kayan's tenant field, over its own fields, and names at least one index.
const termFields = {
  ...defaultFields,
  organization: tenant.field,
  code: { kind: 'text', label: { en: 'Code', ar: 'الرمز' } },
  term: { kind: 'text', label: { en: 'Term', ar: 'الفصل' } },
} as const
defineKayan({
  name: 'groupProbe',
  fields: termFields,
  indexes: [{ within: 'organization', unique: ['code', ['code', 'term']], index: ['term'] }],
  targets: { service: { operations: defaultOperations } },
})
defineKayan({
  name: 'groupProbe',
  fields: termFields,
  indexes: ({ defaults }) => [...defaults, { within: 'organization', index: [['term', 'code']] }],
  targets: { service: { operations: defaultOperations } },
})
defineKayan({
  name: 'groupProbe',
  fields: termFields,
  // @ts-expect-error "cod" is no field of this kayan
  indexes: [{ within: 'organization', unique: [['cod', 'term']] }],
  targets: { service: { operations: defaultOperations } },
})
defineKayan({
  name: 'groupProbe',
  fields: termFields,
  // @ts-expect-error a group is within the tenant field, and "code" is not it
  indexes: [{ within: 'code', unique: ['term'] }],
  targets: { service: { operations: defaultOperations } },
})
defineKayan({
  name: 'groupProbe',
  fields: termFields,
  // @ts-expect-error a group names at least one index
  indexes: [{ within: 'organization' }],
  targets: { service: { operations: defaultOperations } },
})
defineKayan({
  name: 'groupProbe',
  fields: termFields,
  // @ts-expect-error a group names at least one index
  indexes: [{ within: 'organization', unique: [], index: [] }],
  targets: { service: { operations: defaultOperations } },
})
defineKayan({
  name: 'groupProbe',
  fields: termFields,
  // @ts-expect-error an entry of a group names at least one field
  indexes: [{ within: 'organization', unique: ['code', []] }],
  targets: { service: { operations: defaultOperations } },
})
defineKayan({
  name: 'groupProbe',
  fields: { code: { kind: 'text', label: { en: 'Code', ar: 'الرمز' } } },
  // @ts-expect-error a shared kayan places no tenant field to be within
  indexes: [{ within: 'code', unique: ['code'] }],
  targets: { service: { operations: defaultOperations } },
})

type TextId = Expect<Equal<(typeof user)['fields']['id']['kind'], 'text'>>
type UuidId = Expect<Equal<(typeof courses)['fields']['id']['kind'], 'uuid'>>
type RequiredTitle = Expect<Equal<(typeof courses)['fields']['title']['rules']['required'], true>>

type Generate = Expect<Equal<(typeof generate)['auth'], '../features/auth/'>>

type Names = Expect<
  Equal<
    keyof typeof asas.kayan,
    | 'account'
    | 'auditLog'
    | 'courses'
    | 'enrollments'
    | 'invitation'
    | 'localUsers'
    | 'media'
    | 'member'
    | 'memberRoles'
    | 'organization'
    | 'organizationRole'
    | 'roles'
    | 'session'
    | 'sessions'
    | 'tags'
    | 'user'
    | 'verification'
  >
>

// @ts-expect-error there is no such kind
defineKayan({ name: 'probe', fields: { a: { kind: 'colour' } }, targets: { service: { operations: defaultOperations } } })
// @ts-expect-error relationTo belongs to the relationship kind
defineKayan({ name: 'probe', fields: { a: { kind: 'text', relationTo: 'courses' } }, targets: { service: { operations: defaultOperations } } })
// @ts-expect-error mode is no key of any kind: a relationship points at one row, and hasMany holds a set
defineKayan({ name: 'probe', fields: { a: { kind: 'relationship', relationTo: 'courses', mode: 'many-to-one' } }, targets: { service: { operations: defaultOperations } } })
// The line below compiles, so the refusals under it fail for the key rather than for the field
// around it.
defineKayan({ name: 'probe', fields: { a: { kind: 'relationship', relationTo: 'courses', hasMany: true } }, targets: { service: { operations: defaultOperations } } })
// @ts-expect-error hasMany takes true alone, because false is the default
defineKayan({ name: 'probe', fields: { a: { kind: 'relationship', relationTo: 'courses', hasMany: false } }, targets: { service: { operations: defaultOperations } } })
// @ts-expect-error hasMany belongs to the relationship kind, like relationTo
defineKayan({ name: 'probe', fields: { a: { kind: 'text', hasMany: true } }, targets: { service: { operations: defaultOperations } } })
// @ts-expect-error there is no such key on any kind
defineKayan({ name: 'probe', fields: { a: { kind: 'text', lengthy: 3 } }, targets: { service: { operations: defaultOperations } } })
// @ts-expect-error the store gives the id column its primary key; no field carries one
defineKayan({ name: 'probe', fields: { a: { kind: 'text', primary: true } }, targets: { service: { operations: defaultOperations } } })
// @ts-expect-error onDelete is the relationship kind's own, even though it is a rule
defineKayan({ name: 'probe', fields: { a: { kind: 'text', onDelete: 'cascade' } }, targets: { service: { operations: defaultOperations } } })

defineKayan({ name: 'probe', targets: { service: { store: 'drizzle', schema: 'zod', operations: defaultOperations } }, fields: {} })
// @ts-expect-error there is no target named "nope"
defineKayan({ name: 'probe', targets: { service: { store: 'nope', operations: defaultOperations } }, fields: {} })
// @ts-expect-error zod shapes values but cannot store rows
defineKayan({ name: 'probe', targets: { service: { store: 'zod', operations: defaultOperations } }, fields: {} })
// @ts-expect-error drizzle stores rows but is not a validation schema
defineKayan({ name: 'probe', targets: { service: { schema: 'drizzle', operations: defaultOperations } }, fields: {} })
// @ts-expect-error pattern is accepted by text, not number
defineKayan({ name: 'probe', fields: { amount: { kind: 'number', rules: { pattern: /x/ } } }, targets: { service: { operations: defaultOperations } } })
// @ts-expect-error min is accepted by number, not text
defineKayan({ name: 'probe', fields: { title: { kind: 'text', rules: { min: 1 } } }, targets: { service: { operations: defaultOperations } } })

defineMithaq({
  arkan: [base],
  targets: {
    drizzle: drizzleAdapter({ connectionString: 'postgresql://never-connected', kinds: drizzleKinds, rules: drizzleRules }),
    // @ts-expect-error the language has six kinds and this target's map names one
    partial: { ...zodTarget, kinds: { text: zodKinds.text }, rules: zodRules },
    service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'drizzle', schema: 'partial', authorize: defaultAuthorize }),
  },
})
defineMithaq({
  arkan: [base],
  targets: {
    drizzle: drizzleAdapter({ connectionString: 'postgresql://never-connected', kinds: drizzleKinds, rules: drizzleRules }),
    // @ts-expect-error `colour` is not a kind the language named
    extra: { ...zodTarget, kinds: { ...zodKinds, colour: zodKinds.text }, rules: zodRules },
    service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'drizzle', schema: 'extra', authorize: defaultAuthorize }),
  },
})

const arkanTargets = {
  drizzle: drizzleAdapter({ connectionString: 'postgresql://never-connected', kinds: drizzleKinds, rules: drizzleRules }),
  zod: zodTarget,
  service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'drizzle', schema: 'zod', authorize: defaultAuthorize }),
}
// @ts-expect-error kind "text" is claimed by two arkan
defineMithaq({ targets: arkanTargets, arkan: [base, defineRukn({ name: 'mine', kinds: { text: defaultKinds.text } })] })
// @ts-expect-error rule "required" is claimed by two arkan
defineMithaq({ targets: arkanTargets, arkan: [base, defineRukn({ name: 'mine', rules: { required: defaultRules.required } })] })
// @ts-expect-error target "history" is built by two arkan
defineMithaq({ targets: arkanTargets, arkan: [base, defineRukn({ name: 'one', targets: { history: versionsTarget({ max: 100 }) } }), defineRukn({ name: 'two', targets: { history: versionsTarget({ max: 100 }) } })] })
// @ts-expect-error kinds come from the arkan alone, never from the root beside them
defineMithaq({ targets: arkanTargets, arkan: [base], kinds: defaultKinds })
// @ts-expect-error rules come from the arkan alone, never from the root beside them
defineMithaq({ targets: arkanTargets, arkan: [base], rules: defaultRules })
// @ts-expect-error rukn "drafts" needs a target of capability "versions", and the build lays down none
defineMithaq({ targets: arkanTargets, arkan: [base, defineRukn({ name: 'drafts', needs: ['versions'] })] })
defineMithaq({ targets: arkanTargets, arkan: [base, defineRukn({ name: 'stored', needs: ['store'] })] })
defineMithaq({ targets: { ...arkanTargets, versions: versionsTarget({ max: 100 }) }, arkan: [base, defineRukn({ name: 'drafts', needs: ['versions'] })] })
// @ts-expect-error target "versions" is laid down by the project and built by rukn "history"
defineMithaq({ targets: { ...arkanTargets, versions: versionsTarget({ max: 100 }) }, arkan: [base, defineRukn({ name: 'history', targets: { versions: versionsTarget({ max: 100 }) } })] })
defineMithaq({ targets: arkanTargets, arkan: [base, richText({ nodes: richTextNodes })] })
// @ts-expect-error kind "richText" is claimed by two arkan
defineMithaq({ targets: arkanTargets, arkan: [base, richText({ nodes: richTextNodes }), richText({ nodes: richTextNodes })] })
defineMithaq({ targets: arkanTargets, arkan: [base, storage(storageConfig)] })
// @ts-expect-error kind "upload" is claimed by two arkan
defineMithaq({ targets: arkanTargets, arkan: [base, storage(storageConfig), defineRukn({ name: 'files', kinds: { upload: storage(storageConfig).kinds.upload } })] })
// @ts-expect-error target "storage" is laid down by the project and built by rukn "storage"
defineMithaq({ targets: { ...arkanTargets, storage: storage(storageConfig).targets.storage }, arkan: [base, storage(storageConfig)] })
defineMithaq({ targets: arkanTargets, arkan: [base, versions({ max: 100 })] })
// @ts-expect-error rukn "versions" needs a target of capability "store"
defineMithaq({ targets: { zod: zodTarget }, arkan: [base, versions({ max: 100 })] })
// @ts-expect-error target "versions" is laid down by the project and built by rukn "versions"
defineMithaq({ targets: { ...arkanTargets, versions: versionsTarget({ max: 100 }) }, arkan: [base, versions({ max: 100 })] })
// @ts-expect-error versionsTarget takes the window it keeps, and picks none of its own
versionsTarget({})
// @ts-expect-error the same, with no argument at all
versionsTarget()
// `fee` is declared a number and its column is text: a field's own column is typed under the name
// its kayan's store has in the build, `db` here.
{
  const { drizzle: db, ...others } = arkanTargets
  const dbLanguage = defineMithaq({ targets: { ...others, db, service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'db', schema: 'zod', authorize: defaultAuthorize }) }, arkan: [base] })
  const built = dbLanguage.buildAsas({
    http: [fetchHttp()],
    kayan: [dbLanguage.defineKayan({ name: 'columned', fields: { id: defaultFields.id, fee: { kind: 'number', targets: { db: textColumn('fee') } } }, targets: { service: { operations: defaultOperations } } })],
  })
  const fee: InferSelectModel<typeof built.targets.db.tables.columned>['fee'] = 'text'
  void fee
}
{
  const numericLanguage = defineMithaq({ targets: arkanTargets, arkan: [base] })
  const built = numericLanguage.buildAsas({
    http: [fetchHttp()],
    kayan: [numericLanguage.defineKayan({ name: 'measured', fields: { id: defaultFields.id, count: { kind: 'integer' }, amount: { kind: 'decimal', rules: { precision: 7, scale: 2 } } }, targets: { service: { operations: defaultOperations } } })],
  })
  type Row = InferSelectModel<typeof built.targets.drizzle.tables.measured>
  const count: Row['count'] = 1
  const amount: Row['amount'] = '9.99'
  // @ts-expect-error an integer column is no text
  const countText: Row['count'] = '1'
  // @ts-expect-error a decimal column is no JS number
  const amountNumber: Row['amount'] = 9.99
  void [count, amount, countText, amountNumber]
}
const slugKind = <const Targets extends Record<string, unknown>>(targets: Targets) =>
  kind<string>((value): value is string => typeof value === 'string')({
    label: { en: 'Slug', ar: 'معرف نصي' },
    message: { en: 'This is not a slug.', ar: 'هذا ليس معرفا نصيا.' },
    rules: ['required'],
    targets,
  })
defineMithaq({
  targets: {
    drizzle: drizzleAdapter({ connectionString: 'postgresql://never-connected', kinds: drizzleKinds, rules: drizzleRules }),
    // @ts-expect-error the zod map names no `slug`, and the kind carries no shape of its own
    zod: zodTarget,
    service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'drizzle', schema: 'zod', authorize: defaultAuthorize }),
  },
  arkan: [base, defineRukn({ name: 'slugs', kinds: { slug: slugKind({ drizzle: drizzleKinds.text }) } })],
})
defineMithaq({
  targets: {
    // @ts-expect-error the drizzle map names no `slug`, and the kind carries no column of its own
    drizzle: drizzleAdapter({ connectionString: 'postgresql://never-connected', kinds: drizzleKinds, rules: drizzleRules }),
    zod: zodTarget,
    service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'drizzle', schema: 'zod', authorize: defaultAuthorize }),
  },
  arkan: [base, defineRukn({ name: 'slugs', kinds: { slug: slugKind({ zod: zodKinds.text }) } })],
})
const slugs = defineMithaq({ targets: arkanTargets, arkan: [base, defineRukn({ name: 'slugs', kinds: { slug: slugKind({ drizzle: drizzleKinds.text, zod: zodKinds.text }) } })] })
slugs.defineKayan({ name: 'slugProbe', fields: { slug: { kind: 'slug', rules: { required: true } } }, targets: { service: { operations: defaultOperations } } })
{
  const anchorKind = kind<number | string>((value): value is number | string => typeof value === 'number' || typeof value === 'string')({
    label: { en: 'Anchor', ar: 'مرساة' },
    message: { en: 'Pick one of the listed entries.', ar: 'اختر عنصرا من القائمة.' },
    rules: ['required', 'onDelete'],
    pointsAtRow: true,
    onDelete: 'cascade',
    targets: { drizzle: drizzleKinds.relationship, zod: zodKinds.relationship },
  })
  type AnchorPointsAtRow = Expect<Equal<(typeof anchorKind)['pointsAtRow'], true>>
  type SlugPointsAtNothing = Expect<Equal<ReturnType<typeof slugKind> extends { pointsAtRow: true } ? true : false, false>>
  const anchors = defineMithaq({
    targets: arkanTargets,
    arkan: [base, defineRukn({ name: 'anchors', kinds: { anchor: anchorKind, slug: slugKind({ drizzle: drizzleKinds.text, zod: zodKinds.text }) } })],
  })
  const anchored = anchors.defineKayan({ name: 'anchored', fields: { id: defaultFields.id }, targets: { service: { operations: defaultOperations } } })
  const anchoring = anchors.defineKayan({
    name: 'anchoring',
    fields: { id: defaultFields.id, parent: { kind: 'anchor', relationTo: () => anchored }, many: { kind: 'anchor', relationTo: () => anchored, hasMany: true } },
    targets: { service: { operations: defaultOperations } },
  })
  // @ts-expect-error a kind that does not point at a row names no kayan
  anchors.defineKayan({ name: 'unanchored', fields: { slug: { kind: 'slug', relationTo: () => anchored } }, targets: { service: { operations: defaultOperations } } })
  const anchoredBuild = anchors.buildAsas({ http: [fetchHttp()], kayan: [anchored, anchoring] })
  type AnchoringRow = NonNullable<Awaited<ReturnType<typeof anchoredBuild.kayan.anchoring.operations.findByID>>>
  type AnchorParent = Expect<Equal<AnchoringRow['parent'], string | null>>
  type AnchorMany = Expect<Equal<AnchoringRow['many'], string[] | null>>
}
// @ts-expect-error `nope` is no target of this build
slugs.defineKayan({ name: 'slugProbe', fields: {}, targets: { service: { operations: defaultOperations }, nope: {} } })
// @ts-expect-error a drizzle store takes a kayan's whole table, never its name
slugs.defineKayan({ name: 'slugProbe', fields: {}, targets: { service: { operations: defaultOperations }, drizzle: 'slugs' } })

// `StoreKeys` reads `Targets[Name] extends { capability: 'store' }` on an indexed access, which
// does not distribute. Over a targets record whose values are a union rather than one target
// apiece, the conditional is false for every name, so `StoreKeys` is `never` and the intersection
// refuses `memory` as hard as it refuses a name no target holds. A language assembled from
// configuration is therefore refused harder than a written one.
const wideTargets: Record<string, typeof zodTarget | ReturnType<typeof memoryStore>> = {
  memory: memoryStore(),
  zod: zodTarget,
}
defineMithaq({
  arkan: [base],
  targets: {
    ...wideTargets,
    // @ts-expect-error `memory` is a store this record holds, and the service target naming it is refused
    service: serviceTarget({
      depth: defaultDepth,
      defaultLimit,
      maxLimit: defaultMaxLimit,
      joinLimit: defaultJoinLimit,
      bulkLimit: defaultBulkLimit,
      store: 'memory',
      // `SchemaKeys` is the same conditional with its arms swapped, so the false branch yields
      // `Name` rather than `never` and the schema name stays open: `zod` is accepted here, and so
      // would a name no target holds be.
      schema: 'zod',
      authorize: defaultAuthorize,
    }),
  },
})

// A target written as a literal is a hole in the `idKinds` check: its condition is a required
// `idKinds`, and every factory returns a type declaring it optional or not at all, so
// `drizzleAdapter({ idKinds: ['slug'] })` is no error, and an `@ts-expect-error` on it would report
// unused. There is none here for that reason, and the build-time refusal is what catches it.
defineMithaq({
  arkan: [base],
  targets: {
    drizzle: drizzleAdapter({ connectionString: 'postgresql://never-connected', kinds: drizzleKinds, rules: drizzleRules }),
    // @ts-expect-error `slug` is not a kind the language named
    strayId: { ...zodTarget, idKinds: ['slug'], kinds: zodKinds, rules: zodRules },
    service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'drizzle', schema: 'strayId', authorize: defaultAuthorize }),
  },
})

const customRules = { ...defaultRules, searchable: defaultRules.required }
const wrongRuleHandlers = {
  ...zodRules,
  // @ts-expect-error searchable is boolean, so its handler cannot demand number
  searchable: (({ shape }) => shape) satisfies ZodRule<number>,
} satisfies { [Name in keyof typeof customRules]: ZodRule<RuleValue<(typeof customRules)[Name]>> }
const customLanguage = defineMithaq({
  arkan: [
    defineRukn({
      name: 'project',
      kinds: {
        ...defaultKinds,
        text: { ...defaultKinds.text, rules: [...defaultKinds.text.rules, 'searchable'] as const },
        money: kind<number>((value): value is number => typeof value === 'number')({
          label: { en: 'Money', ar: 'مال' },
          message: { en: 'This is not money.', ar: 'هذا ليس مالا.' },
          rules: ['required', 'defaultValue', 'min', 'max', 'searchable'],
        }),
      },
      rules: customRules,
    }),
  ],
  targets: {
    drizzle: drizzleAdapter({
      connectionString: 'postgresql://never-connected',
      kinds: { ...drizzleKinds, money: drizzleKinds.number },
      rules: { ...drizzleRules, searchable: drizzleRules.required },
      push: false,
    }),
    zod: {
      ...zodTarget,
      kinds: { ...zodKinds, money: zodKinds.number },
      rules: { ...zodRules, searchable: zodRules.required },
    },
    service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'drizzle', schema: 'zod', authorize: defaultAuthorize }),
  },
})
const customKayan = customLanguage.defineKayan({
  name: 'probe',
  fields: { title: { kind: 'text', rules: { searchable: false } }, budget: { kind: 'money' } },
  targets: { service: { operations: defaultOperations } },
})
// A project-added rule is accepted by the bound build path, not only by the language's declaration
// path.
customLanguage.buildAsas({ http: [fetchHttp()], kayan: [customKayan] })
// @ts-expect-error the custom rule's value is boolean
customLanguage.defineKayan({ name: 'probe', fields: { title: { kind: 'text', rules: { searchable: 'yes' } } }, targets: { service: { operations: defaultOperations } } })
// @ts-expect-error the language names no `searchWeight` rule
customLanguage.defineKayan({ name: 'probe', fields: { title: { kind: 'text', rules: { searchWeight: 2 } } }, targets: { service: { operations: defaultOperations } } })
// @ts-expect-error a number default must be a number or a supported dynamic token
defineKayan({ name: 'probe', fields: { amount: { kind: 'number', rules: { defaultValue: 'free' } } }, targets: { service: { operations: defaultOperations } } })
type NoNow = Expect<Equal<'now' extends keyof typeof import('mithaq') ? true : false, false>>
defineKayan({ name: 'probe', fields: { moment: { kind: 'datetime', rules: { defaultNow: true, nowOnUpdate: true } } }, targets: { service: { operations: defaultOperations } } })
// @ts-expect-error `defaultNow` is not a rule the text kind binds
defineKayan({ name: 'probe', fields: { title: { kind: 'text', rules: { defaultNow: true } } }, targets: { service: { operations: defaultOperations } } })
// @ts-expect-error nor the calendar day's, which no caller has asked it of
defineKayan({ name: 'probe', fields: { day: { kind: 'date', rules: { defaultNow: true } } }, targets: { service: { operations: defaultOperations } } })
// @ts-expect-error `nowOnUpdate` is a boolean
defineKayan({ name: 'probe', fields: { moment: { kind: 'datetime', rules: { nowOnUpdate: 'always' } } }, targets: { service: { operations: defaultOperations } } })
// @ts-expect-error a calendar day's own literal is still the ISO day string
defineKayan({ name: 'probe', fields: { day: { kind: 'date', rules: { defaultValue: new Date() } } }, targets: { service: { operations: defaultOperations } } })
defineKayan({
  name: 'probe',
  fields: {},
  targets: {
    service: {
      // @ts-expect-error an operation declares steps and an optional output, and nothing else
      operations: { ...defaultOperations, create: { effect: 'create', steps: [insert] } },
    },
  },
})

const typedCustomOperation = customLanguage.defineKayan({
  name: 'typedCustomOperation',
  fields: {},
  targets: {
    service: {
      operations: {
        ...defaultOperations,
        custom: { input: () => z.object({ a: z.string() }), steps: [insert] },
      },
    },
  },
})
customLanguage.defineKayan({
  name: 'scalarOutputOperation',
  fields: {},
  targets: {
    service: {
      operations: {
        ...defaultOperations,
        custom: {
          // @ts-expect-error custom output must return a row object, not a scalar
          output: z.object({ a: z.string() }).transform((row) => row.a),
          steps: [insert],
        },
      },
    },
  },
})
customLanguage.defineKayan({
  name: 'twoNamespaceOperation',
  fields: {},
  targets: {
    service: {
      operations: {
        ...defaultOperations,
        custom: {
          steps: ({ operations, steps }) => {
            type OperationsCreateIsAList = Expect<Equal<typeof operations.create extends readonly unknown[] ? true : false, true>>
            type StepsUpdateIsAStep = Expect<Equal<typeof steps.update extends (...args: never[]) => unknown ? true : false, true>>
            // @ts-expect-error `create` is an operation list, not a step
            steps.create
            // @ts-expect-error `defaults` is a step, not an operation list
            operations.defaults
            return [...operations.create]
          },
        },
      },
    },
  },
})

const customOperationBuilt = customLanguage.buildAsas({ http: [fetchHttp()], kayan: [typedCustomOperation] })
customOperationBuilt.kayan.typedCustomOperation.operations.custom({ a: 'typed input' })
// @ts-expect-error a custom operation's input is what its validate function returns
customOperationBuilt.kayan.typedCustomOperation.operations.custom({ b: 1 })

const typedOverride = customLanguage.defineKayan({
  name: 'typedOverride',
  fields: { id: { kind: 'number' }, title: { kind: 'text' } },
  targets: {
    service: {
      operations: {
        ...defaultOperations,
        create: {
          input: () => z.object({ title: z.string(), nonce: z.string() }),
          steps: ({ steps }) => [steps.insert],
          output: z.object({ receipt: z.string() }),
        },
        update: {
          input: () => z.object({ id: z.number(), expectedUpdatedAt: z.date() }),
          steps: ({ steps }) => [steps.update],
          output: z.object({ receipt: z.string() }),
        },
        delete: {
          input: () => z.object({ id: z.number(), reason: z.string() }),
          steps: ({ steps }) => [steps.remove],
          output: z.object({ receipt: z.string() }),
        },
        find: {
          input: () => z.object({ tag: z.string() }),
          steps: ({ steps }) => [steps.find],
          output: z.object({ receipt: z.string() }),
        },
        findByID: {
          input: () => z.object({ id: z.number(), tag: z.string() }),
          steps: ({ steps }) => [steps.findOne],
          output: z.object({ receipt: z.string() }),
        },
        updateMany: {
          input: () => z.object({ where: z.unknown(), data: z.object({ title: z.string() }), nonce: z.string() }),
          steps: ({ steps }) => [steps.updateMany],
          output: z.object({ count: z.number() }),
        },
        deleteMany: {
          input: () => z.object({ where: z.unknown(), nonce: z.string() }),
          steps: ({ steps }) => [steps.deleteMany],
          output: z.object({ count: z.number() }),
        },
        findTagged: {
          input: () => z.object({ tag: z.string() }),
          steps: ({ steps }) => [steps.find],
          output: z.object({ receipt: z.string() }),
        },
        bulkRename: {
          input: () => z.object({ where: z.unknown(), data: z.object({ title: z.string() }), nonce: z.string() }),
          steps: ({ steps }) => [steps.updateMany],
          output: z.object({ count: z.number() }),
        },
        bulkReset: { steps: ({ steps }) => [steps.updateMany] },
      },
    },
  },
})
const overrideBuilt = customLanguage.buildAsas({ http: [fetchHttp()], kayan: [typedOverride] })
const { create: _shippedCreate, ...withoutShippedCreate } = defaultOperations
const withoutCreate = customLanguage.defineKayan({
  name: 'withoutCreate',
  fields: { id: { kind: 'number' }, title: { kind: 'text' } },
  targets: { service: { operations: { ...withoutShippedCreate, upload: defaultOperations.create } } },
})
const withoutCreateBuilt = customLanguage.buildAsas({ http: [fetchHttp()], kayan: [withoutCreate] })
withoutCreateBuilt.kayan.withoutCreate.operations.upload({ title: 'A' })
// @ts-expect-error create was left out, so the client has none
withoutCreateBuilt.kayan.withoutCreate.operations.create({ title: 'A' })
customLanguage.defineKayan({
  name: 'undefinedCreate',
  fields: { id: { kind: 'number' } },
  // @ts-expect-error an operation is a declaration, never undefined
  targets: { service: { operations: { ...defaultOperations, create: undefined } } },
})
overrideBuilt.kayan.typedOverride.operations.create({ title: 'A', nonce: 'n' })
// @ts-expect-error declared create input requires nonce
overrideBuilt.kayan.typedOverride.operations.create({ title: 'A' })
type OverrideCreateResult = Expect<Equal<Awaited<ReturnType<typeof overrideBuilt.kayan.typedOverride.operations.create>>, { receipt: string }>>
overrideBuilt.kayan.typedOverride.operations.update({ id: 1, expectedUpdatedAt: new Date() })
// @ts-expect-error the declared input requires expectedUpdatedAt
overrideBuilt.kayan.typedOverride.operations.update({ id: 1 })
type OverrideUpdateResult = Expect<Equal<Awaited<ReturnType<typeof overrideBuilt.kayan.typedOverride.operations.update>>, { receipt: string }>>
overrideBuilt.kayan.typedOverride.operations.delete({ id: 1, reason: 'duplicate' })
// @ts-expect-error declared delete input requires reason
overrideBuilt.kayan.typedOverride.operations.delete({ id: 1 })
type OverrideDeleteResult = Expect<Equal<Awaited<ReturnType<typeof overrideBuilt.kayan.typedOverride.operations.delete>>, { receipt: string }>>
overrideBuilt.kayan.typedOverride.operations.find({ tag: 'current' })
// @ts-expect-error declared find input is required
overrideBuilt.kayan.typedOverride.operations.find()
type OverrideFindDoc = Expect<Equal<Awaited<ReturnType<typeof overrideBuilt.kayan.typedOverride.operations.find>>['docs'][number], { receipt: string }>>
overrideBuilt.kayan.typedOverride.operations.findByID({ id: 1, tag: 'current' })
// @ts-expect-error declared findByID input requires tag
overrideBuilt.kayan.typedOverride.operations.findByID({ id: 1 })
// A read of one row answers it or is refused 404, so its type holds no `null`.
type OverrideFindByIDResult = Expect<Equal<Awaited<ReturnType<typeof overrideBuilt.kayan.typedOverride.operations.findByID>>, { receipt: string }>>
overrideBuilt.kayan.typedOverride.operations.updateMany({ where: { id: { equals: 1 } }, data: { title: 'B' }, nonce: 'n' })
// @ts-expect-error declared updateMany input requires nonce
overrideBuilt.kayan.typedOverride.operations.updateMany({ where: { id: { equals: 1 } }, data: { title: 'B' } })
type OverrideUpdateManyResult = Expect<Equal<Awaited<ReturnType<typeof overrideBuilt.kayan.typedOverride.operations.updateMany>>, { count: number }>>
overrideBuilt.kayan.typedOverride.operations.deleteMany({ where: { id: { equals: 1 } }, nonce: 'n' })
// @ts-expect-error declared deleteMany input requires nonce
overrideBuilt.kayan.typedOverride.operations.deleteMany({ where: { id: { equals: 1 } } })
type OverrideDeleteManyResult = Expect<Equal<Awaited<ReturnType<typeof overrideBuilt.kayan.typedOverride.operations.deleteMany>>, { count: number }>>
overrideBuilt.kayan.typedOverride.operations.findTagged({ tag: 'current' })
// @ts-expect-error custom find input is required
overrideBuilt.kayan.typedOverride.operations.findTagged()
type OverrideFindTaggedDoc = Expect<Equal<Awaited<ReturnType<typeof overrideBuilt.kayan.typedOverride.operations.findTagged>>['docs'][number], { receipt: string }>>
overrideBuilt.kayan.typedOverride.operations.bulkRename({ where: { id: { equals: 1 } }, data: { title: 'B' }, nonce: 'n' })
type OverrideBulkRenameResult = Expect<Equal<Awaited<ReturnType<typeof overrideBuilt.kayan.typedOverride.operations.bulkRename>>, { count: number }>>
overrideBuilt.kayan.typedOverride.operations.bulkReset({ where: { id: { equals: 1 } }, data: { title: 'B' } })
type OverrideBulkResetResult = Expect<Equal<Awaited<ReturnType<typeof overrideBuilt.kayan.typedOverride.operations.bulkReset>>['docs'][number]['title'], string | null>>
type OverrideBound = BoundKayans<readonly [typeof typedOverride], typeof customLanguage>
type OverrideProcedures = OperationProcedures<readonly [typeof typedOverride], readonly [], readonly [typeof typedOverride], typeof customLanguage>
type BoundUpdateInput = Expect<Equal<Parameters<OverrideBound['typedOverride']['update']>[0], { id: number; expectedUpdatedAt: Date }>>
type BoundUpdateOutput = Expect<Equal<Awaited<ReturnType<OverrideBound['typedOverride']['update']>>, { receipt: string }>>
type ProcedureUpdateInput = Expect<Equal<Parameters<OverrideProcedures['typedOverride']['update']>[0], { id: number; expectedUpdatedAt: Date }>>
type ProcedureFindDoc = Expect<Equal<Awaited<ReturnType<OverrideProcedures['typedOverride']['find']>>['docs'][number], { receipt: string }>>
type ProcedureBulkOutput = Expect<Equal<Awaited<ReturnType<OverrideProcedures['typedOverride']['updateMany']>>, { count: number }>>
declare const overrideBound: OverrideBound
overrideBound.typedOverride.find({ tag: 'current' })
// @ts-expect-error declared find input is required in bound tools too
overrideBound.typedOverride.find()
overrideBound.typedOverride.findByID({ id: 1, tag: 'current' })
// @ts-expect-error a bound call takes its input alone, and its options are the step's own
overrideBound.typedOverride.findByID({ id: 1, tag: 'current' }, { depth: 1 })
// @ts-expect-error `find` too, since no name chooses another shape
overrideBound.typedOverride.find({ tag: 'current' }, {})
const countPicked = customLanguage.defineKayan({
  name: 'countPicked',
  fields: { id: { kind: 'number' }, title: { kind: 'text' } },
  targets: { service: { operations: { ...defaultOperations, count: { input: () => z.object({ id: z.number() }), steps: ({ steps }) => [steps.findOne] } } } },
})
const countWritten = customLanguage.defineKayan({
  name: 'countWritten',
  fields: { id: { kind: 'number' }, title: { kind: 'text' } },
  targets: { service: { operations: { ...defaultOperations, count: { steps: ({ steps }) => [steps.insert] } } } },
})
const countNamesBuilt = customLanguage.buildAsas({ http: [fetchHttp()], kayan: [countPicked, countWritten] })
countNamesBuilt.kayan.countPicked.operations.count({ id: 1 })
// @ts-expect-error the declared input requires the id
countNamesBuilt.kayan.countPicked.operations.count({})
type CountPickedRow = Awaited<ReturnType<typeof countNamesBuilt.kayan.countPicked.operations.count>>
type CountPickedResult = Expect<Equal<NonNullable<CountPickedRow>['title'], string | null>>
type CountPickedNeverNull = Expect<Equal<null extends CountPickedRow ? true : false, false>>
type CountWrittenResult = Expect<Equal<Awaited<ReturnType<typeof countNamesBuilt.kayan.countWritten.operations.count>>['title'], string | null>>
type CountWrittenInput = Expect<Equal<NonNullable<Parameters<typeof countNamesBuilt.kayan.countWritten.operations.count>[0]>['title'], string | null | undefined>>
type BoundTypedCustom = BoundKayans<readonly [typeof typedCustomOperation], typeof customLanguage, 'write'>
declare const boundTypedCustom: BoundTypedCustom
boundTypedCustom.typedCustomOperation.custom({ a: 'typed input' })
// @ts-expect-error bound kayan tools inherit actor/context and accept no operation options
boundTypedCustom.typedCustomOperation.custom({ a: 'typed input' }, { actor: null })
const typedBoundKayanStep: WriteStep<Record<string, unknown>, Record<string, unknown>, unknown, unknown, BoundTypedCustom> = (_ctx, tools) => {
  tools.kayans.typedCustomOperation.custom({ a: 'typed input' })
  // @ts-expect-error bound step registry has no actor/context override hole
  tools.kayans.typedCustomOperation.custom({ a: 'typed input' }, { context: {} })
  return _ctx
}
void typedBoundKayanStep
type BoundTypedCustomRead = BoundKayans<readonly [typeof typedCustomOperation], typeof customLanguage, 'read'>
declare const boundTypedCustomRead: BoundTypedCustomRead
// @ts-expect-error read-step bound tools expose only read-effect operations
boundTypedCustomRead.typedCustomOperation.custom({ a: 'typed input' })
const { delete: _shippedDelete, deleteMany: _shippedDeleteMany, ...withoutDelete } = defaultOperations
const disabledDeleteOperation = customLanguage.defineKayan({
  name: 'disabledDeleteOperation',
  fields: {},
  targets: {
    service: {
      operations: withoutDelete,
    },
  },
})
customLanguage.defineKayan({
  name: 'falseDeleteOperation',
  fields: {},
  targets: {
    service: {
      // @ts-expect-error false is no operation value, so a kayan leaves the name out instead
      operations: { ...defaultOperations, delete: false },
    },
  },
})
type BoundDisabledDelete = BoundKayans<readonly [typeof disabledDeleteOperation], typeof customLanguage, 'write'>
declare const boundDisabledDelete: BoundDisabledDelete
// @ts-expect-error an operation left out of the record is absent from bound tools
boundDisabledDelete.disabledDeleteOperation.delete({ id: 1 })
const operationless = customLanguage.defineKayan({ name: 'operationless', fields: {} })
type OperationlessHasNone = Expect<Equal<keyof BoundKayans<readonly [typeof operationless], typeof customLanguage, 'write'>['operationless'], never>>

const plainCode: StandardSchemaV1<string, 'A' | 'B'> = {
  '~standard': {
    version: 1,
    vendor: 'plain',
    validate: (value) => ({ value: String(value).toUpperCase() as 'A' | 'B' }),
  },
}
const plainLanguage = defineMithaq({
  arkan: [base],
  targets: {
    drizzle: drizzleAdapter({ connectionString: 'postgresql://never-connected', kinds: drizzleKinds, rules: drizzleRules, push: false }),
    zod: zodTarget,
    plain: plainTarget,
    service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'drizzle', schema: 'plain', authorize: defaultAuthorize }),
  },
})
const plainKayan = plainLanguage.defineKayan({
  name: 'plainKayan',
  targets: {
    service: {
      schema: 'plain',
      operations: {
        ...defaultOperations,
        custom: {
          input: (schemas) => {
            type HandedCreate = Expect<Equal<InferInput<typeof schemas.create>['code'], string | null | undefined>>
            type HandedRow = Expect<Equal<InferOutput<typeof schemas.row>['code'], 'A' | 'B' | null>>
            type HandedKind = Expect<Equal<InferOutput<typeof schemas.row>['ignored'], number | null>>
            // @ts-expect-error the plain target's shapes carry none of zod's methods
            schemas.row.extend({})
            return schemas.create
          },
          steps: ({ steps }) => [steps.insert],
          output: (schemas) => schemas.row,
        },
      },
    },
  },
  fields: {
    id: { kind: 'number' },
    code: { kind: 'text', targets: { plain: plainCode } },
    ignored: { kind: 'number', targets: { zod: z.string() } },
  },
})
const plainBuilt = plainLanguage.buildAsas({ http: [fetchHttp()], kayan: [plainKayan] })
type PlainRow = Awaited<ReturnType<typeof plainBuilt.kayan.plainKayan.operations.create>>
type PlainOverrideOutput = Expect<Equal<PlainRow['code'], 'A' | 'B' | null>>
plainBuilt.kayan.plainKayan.operations.create({ code: 'a' })
// @ts-expect-error the override's input is a string, whatever the kind would take
plainBuilt.kayan.plainKayan.operations.create({ code: 1 })
type PlainIgnoresOtherTargets = Expect<Equal<PlainRow['ignored'], number | null>>
type PlainCustomRow = Awaited<ReturnType<typeof plainBuilt.kayan.plainKayan.operations.custom>>
type PlainCustomOverride = Expect<Equal<PlainCustomRow['code'], 'A' | 'B' | null>>
type PlainCustomKind = Expect<Equal<PlainCustomRow['ignored'], number | null>>
type PlainCustomInput = Expect<Equal<NonNullable<Parameters<typeof plainBuilt.kayan.plainKayan.operations.custom>[0]>['code'], string | null | undefined>>
plainBuilt.kayan.plainKayan.operations.custom({ code: 'a' })
// @ts-expect-error the derived create shape names the kayan's fields and no others
plainBuilt.kayan.plainKayan.operations.custom({ codee: 'a' })

// A schema target carries a `derives` member because the direct `infer` reading of a generic
// `derive` gives back the constraint's shapes, `Record<string, ResolvedField>`'s, only when the
// fields asked about are that constraint, and every derived column then reads off a field whose
// kind is `string`. Asked about one kayan's own fields the signature does not match at all, and the
// reading is `never`.
//
// Both readings are named by what they are, so a collapse of either one is red here rather than
// silently satisfying an inequality. The day TypeScript instantiates a generic signature through
// `infer`, this probe goes red and the phantom member can go.
type ThroughInfer<Schema, Fields extends Record<string, RuntimeField>> = Schema extends {
  derive: (fields: Fields) => infer Shapes
}
  ? Shapes
  : never
type PlainFields = (typeof plainKayan)['fields']
type InferReadsTheConstraint = Expect<
  Equal<
    ThroughInfer<typeof plainTarget, Record<string, ResolvedField>>,
    DerivedSchemas<typeof plainTarget, Record<string, ResolvedField>>
  >
>
type InferMissesOneKayansFields = Expect<Equal<ThroughInfer<typeof plainTarget, PlainFields>, never>>

// A kayan that names a schema target other than the language's. `OverrideSchema` reads the
// language's `schema` name, `plain` here, so a field override written under the kayan's own target,
// `zod`, is not the key it looks for and the column falls back to the type its kind gives it. The
// build-time derivation does honour the override, so the fallback is the safe direction.
const zodInPlainLanguage = plainLanguage.defineKayan({
  name: 'zodInPlainLanguage',
  targets: {
    service: {
      schema: 'zod',
      operations: defaultOperations,
    },
  },
  fields: {
    id: { kind: 'number' },
    code: { kind: 'text', targets: { zod: z.literal('A') } },
  },
})
const mismatchBuilt = plainLanguage.buildAsas({ http: [fetchHttp()], kayan: [zodInPlainLanguage] })
type MismatchRow = Awaited<ReturnType<typeof mismatchBuilt.kayan.zodInPlainLanguage.operations.create>>
type OverrideFallsBackToKind = Expect<Equal<MismatchRow['code'], string | null>>
type OverrideInputFallsBackToKind = Expect<
  Equal<NonNullable<Parameters<typeof mismatchBuilt.kayan.zodInPlainLanguage.operations.create>[0]>['code'], string | null | undefined>
>

type WithSessions = NonNullable<Awaited<ReturnType<typeof asas.kayan.courses.operations.findWithSessions>>>
type CarriesTitle = Expect<Equal<WithSessions['title'], string>>
type CarriesFee = Expect<Equal<WithSessions['fee'], number | null>>
type CarriesSessions = Expect<
  Equal<WithSessions['sessions'], { id: string; startsAt: Date; capacity: number | null; venue?: string | null | undefined; format?: string | null | undefined; archived?: boolean | null | undefined; seatsLeft: number | null }[]>
>
// A relationship's value type needs the kayan it points at, which `derive` cannot see, so it is
// `unknown` in every derived shape. `buildAsas` has the registry and types the same column on the
// shipped `findByID` below.
type DerivedRelationshipIsUnknown = Expect<Equal<WithSessions['cover'], unknown>>
type FindWithSessionsInput = Expect<Equal<Parameters<typeof asas.kayan.courses.operations.findWithSessions>[0], { id: string }>>
void asas.kayan.courses.operations.findWithSessions({ id: '0e6c6f3e-8a0f-4a5f-9d2b-3d5f9a1c2e40' })
// @ts-expect-error the picked id is the string the uuid id field declares
void asas.kayan.courses.operations.findWithSessions({ id: 1 })
declare const plainCourse: NonNullable<Awaited<ReturnType<typeof asas.kayan.courses.operations.findByID>>>
type BuiltRelationshipIsTyped = Expect<Equal<typeof plainCourse.cover, string | null>>
type BuiltTenantIsAString = Expect<Equal<typeof plainCourse.organization, string>>
// @ts-expect-error an operation with no output returns the kayan's row, which has no sessions
plainCourse.sessions

// `course` is a thunk, and the handle's registry is `sessions` alone, so the column is typed from
// the thunk's own target, `courses`, whose id is a uuid.
declare const writeTools: WriteTools
declare const readTools: ReadTools
declare const courseId: string
const madeSession = writeTools.of(sessions).create({ course: courseId, startsAt: new Date(), capacity: 3 })
type OfCreatedSession = Expect<Equal<Awaited<typeof madeSession>['startsAt'], Date>>
type OfSessionCourse = Expect<Equal<Awaited<typeof madeSession>['course'], string>>
// @ts-expect-error the thunk types `course` as the courses id, a string
writeTools.of(sessions).create({ course: 42, startsAt: new Date() })
// @ts-expect-error `startsAt` is required
writeTools.of(sessions).create({ course: courseId })
// @ts-expect-error a key no field declares
writeTools.of(sessions).create({ course: courseId, startsAt: new Date(), room: 'A' })
// @ts-expect-error a bound call takes its input alone
writeTools.of(sessions).create({ course: courseId, startsAt: new Date() }, { depth: 1 })
const readSessions = readTools.of(sessions).find({ where: { course: { equals: courseId } }, limit: 0 })
type OfReadSession = Expect<Equal<Awaited<typeof readSessions>['docs'][number]['startsAt'], Date>>
// @ts-expect-error a read step's handle has no create
readTools.of(sessions).create
// @ts-expect-error nor update
readTools.of(sessions).update
// @ts-expect-error nor delete
readTools.of(sessions).delete
writeTools.of(courses).archive({ id: courseId, reason: 'r' })
// @ts-expect-error `reason` is a string
writeTools.of(courses).archive({ id: courseId, reason: 1 })
// `tags` is a relationship written as a name string, which a registry of one kayan cannot resolve,
// so its column is `never` through the handle.
type OfStringRelationship = Expect<Equal<NonNullable<Awaited<ReturnType<ReturnType<typeof writeTools.of<typeof courses>>['findByID']>>>['tags'], never[] | null>>

const registeredIdentity = defineKayan({ name: 'registeredIdentity', fields: { ...defaultFields }, targets: { service: { operations: defaultOperations } } })
// @ts-expect-error duplicate literal kayan names are rejected before build
buildAsas({ http: [fetchHttp()], kayan: [registeredIdentity, registeredIdentity] })
const impostorIdentity = defineKayan({
  name: 'registeredIdentity',
  fields: { id: { kind: 'text' } },
  targets: { service: { operations: defaultOperations } },
})
const identityLink = defineKayan({
  name: 'identityLink',
  fields: { identity: { kind: 'relationship', relationTo: () => impostorIdentity } },
  targets: { service: { operations: defaultOperations } },
})
const identityBuild = buildAsas({ http: [fetchHttp()], kayan: [registeredIdentity, identityLink] })
identityBuild.kayan.identityLink.operations.create({ identity: '0e6c6f3e-8a0f-4a5f-9d2b-3d5f9a1c2e40' })
// @ts-expect-error relationship value follows registered kayan ID, not unrelated thunk object
identityBuild.kayan.identityLink.operations.create({ identity: 1 })

const transformedKayan = defineKayan({
  name: 'transformed',
  fields: {
    amount: { kind: 'number', targets: { zod: z.string().transform((value) => Number(value)).pipe(z.number()) } },
  },
  targets: { service: { operations: defaultOperations } },
})
const transformedBuild = buildAsas({ http: [fetchHttp()], kayan: [transformedKayan] })
const transformedRow = transformedBuild.kayan.transformed.operations.create({ amount: '12' })
// @ts-expect-error override input is z.input<string>, not its numeric output
transformedBuild.kayan.transformed.operations.create({ amount: 12 })
type TransformedAmount = Expect<
  Equal<Awaited<typeof transformedRow>['amount'], number | null>
>

const narrowDateLanguage = defineMithaq({
  arkan: [
    defineRukn({
      name: 'project',
      kinds: {
        ...defaultKinds,
        narrowDate: kind<Date & { readonly narrow: true }>(
          (value): value is Date & { readonly narrow: true } => value instanceof Date && 'narrow' in value,
        )({
          label: { en: 'Narrow date', ar: 'تاريخ ضيق' },
          message: { en: 'This is not a narrow date.', ar: 'هذا ليس تاريخا ضيقا.' },
          rules: ['defaultValue'],
        }),
      },
      rules: defaultRules,
    }),
  ],
  targets: {
    drizzle: drizzleAdapter({
      connectionString: 'postgresql://never-connected',
      kinds: { ...drizzleKinds, narrowDate: drizzleKinds.datetime },
      rules: drizzleRules,
      push: false,
    }),
    zod: { ...zodTarget, kinds: { ...zodTarget.kinds, narrowDate: zodTarget.kinds.datetime } },
    service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'drizzle', schema: 'zod', authorize: defaultAuthorize }),
  },
})
narrowDateLanguage.defineKayan({
  name: 'narrowDateProbe',
  fields: {
    // @ts-expect-error a plain Date is not the narrow Date subtype
    happenedAt: { kind: 'narrowDate', rules: { defaultValue: new Date() } },
  },
  targets: { service: { operations: defaultOperations } },
})

const secondStoreLanguage = defineMithaq({
  arkan: [base],
  targets: {
    drizzle: drizzleAdapter({
      connectionString: 'postgresql://never-connected',
      kinds: drizzleKinds,
      rules: drizzleRules,
      push: false,
    }),
    memory: memoryStore(),
    zod: zodTarget,
    service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'drizzle', schema: 'zod', authorize: defaultAuthorize }),
  },
})
const memoryOnly = secondStoreLanguage.defineKayan({
  name: 'memoryOnly',
  targets: {
    service: {
      store: 'memory',
      operations: defaultOperations,
    },
  },
  fields: { id: { kind: 'text' }, body: { kind: 'text' } },
})
const secondStoreBuilt = secondStoreLanguage.buildAsas({ http: [fetchHttp()], kayan: [memoryOnly] })
// @ts-expect-error Drizzle did not build a table for a kayan stored in memory
secondStoreBuilt.targets.drizzle.tables.memoryOnly

type MemoryOnlyOutputs = Expect<Equal<keyof (typeof secondStoreBuilt.kayan.memoryOnly)['targets'], 'service' | 'zod'>>
// @ts-expect-error a kayan on the memory store has no drizzle output to read a table off
secondStoreBuilt.kayan.memoryOnly.targets.drizzle
type MemoryOnlyShortcut = Expect<
  Equal<(typeof secondStoreBuilt.kayan.memoryOnly)['operations'], (typeof secondStoreBuilt.kayan.memoryOnly)['targets']['service']['operations']>
>
type MemoryOnlyCreate = Expect<Equal<InferInput<(typeof secondStoreBuilt.kayan.memoryOnly)['targets']['zod']['schemas']['create']>['body'], string | null | undefined>>
secondStoreBuilt.kayan.memoryOnly.targets.zod.schemas.row.extend({})
type PlainOutputs = Expect<Equal<keyof (typeof plainBuilt.kayan.plainKayan)['targets'], 'service' | 'plain' | 'drizzle'>>
type PlainSchemaOutput = Expect<Equal<InferOutput<(typeof plainBuilt.kayan.plainKayan)['targets']['plain']['schemas']['row']>['code'], 'A' | 'B' | null>>
// @ts-expect-error the plain target's shapes carry none of zod's methods
plainBuilt.kayan.plainKayan.targets.plain.schemas.row.extend({})
// A column a rukn's kind builds is typed by that kind: rich text's is Lexical's editor state, which
// drizzle types as nothing narrower, and a course's cover is the uuid of the image it points at.
type CourseColumns = InferSelectModel<typeof asas.targets.drizzle.tables.courses>
type DetailsColumn = Expect<Equal<CourseColumns['details'], unknown>>
type CoverColumn = Expect<Equal<CourseColumns['cover'], string | null>>
type PlainTable = Expect<Equal<(typeof plainBuilt.kayan.plainKayan)['targets']['drizzle']['table'], (typeof plainBuilt.targets.drizzle.tables)['plainKayan']>>
// A `hasMany` join table is typed under the name the store builds it by, `<dbName>_<field>`, not
// the kayan's name.
const taxRate = plainLanguage.defineKayan({
  name: 'taxRate',
  dbName: 'tax_rates',
  fields: { id: { kind: 'number' }, appliesTo: { kind: 'relationship', relationTo: 'plainKayan', hasMany: true } },
})
const undated = plainLanguage.defineKayan({
  name: 'undated',
  fields: { id: { kind: 'number' }, appliesTo: { kind: 'relationship', relationTo: 'plainKayan', hasMany: true } },
})
type TaxTables = (typeof taxBuilt)['targets']['drizzle']['tables']
const taxSettings = plainLanguage.defineGlobal({
  name: 'taxSettings',
  dbName: 'tax_settings',
  fields: { id: { kind: 'number' }, appliesTo: { kind: 'relationship', relationTo: 'plainKayan', hasMany: true } },
})
// A `dbName` that is a plain `string` is no literal, so it types under the kayan's name, while the
// store builds it under the real name.
const wideName: string = 'wide_rates'
const wideRate = plainLanguage.defineKayan({
  name: 'wideRate',
  dbName: wideName,
  fields: { id: { kind: 'number' }, appliesTo: { kind: 'relationship', relationTo: 'plainKayan', hasMany: true } },
})
const taxBuilt = plainLanguage.buildAsas({ http: [fetchHttp()], kayan: [plainKayan, taxRate, undated, wideRate], global: [taxSettings] })
type JoinUnderDbName = Expect<Equal<'tax_rates_applies_to' extends keyof TaxTables ? true : false, true>>
type JoinNotUnderKayanName = Expect<Equal<'taxRate_applies_to' extends keyof TaxTables ? true : false, false>>
type JoinWithoutDbName = Expect<Equal<'undated_applies_to' extends keyof TaxTables ? true : false, true>>
type GlobalJoinUnderDbName = Expect<Equal<'tax_settings_applies_to' extends keyof TaxTables ? true : false, true>>
type GlobalJoinNotUnderName = Expect<Equal<'taxSettings_applies_to' extends keyof TaxTables ? true : false, false>>
type WideJoinUnderKayanName = Expect<Equal<'wideRate_applies_to' extends keyof TaxTables ? true : false, true>>
type WideJoinNotUnderDbName = Expect<Equal<'wide_rates_applies_to' extends keyof TaxTables ? true : false, false>>

const check = async () => {
  await customLanguage.buildAsas({ http: [fetchHttp()], kayan: [customKayan] }).kayan.probe.operations.create({ budget: 10 })
  // @ts-expect-error money carries number, not an arbitrary object
  await customLanguage.buildAsas({ http: [fetchHttp()], kayan: [customKayan] }).kayan.probe.operations.create({ budget: { amount: 10 } })
  const read = await asas.targets.drizzle.db.select().from(asas.targets.drizzle.tables.courses!)
  const first: unknown = read[0]
  const readTitle: string = read[0]!.title
  const readFee: number | null = read[0]!.fee
  // @ts-expect-error only registered kayan have tables
  asas.targets.drizzle.tables.notAKayan
  // @ts-expect-error only declared fields have columns
  asas.targets.drizzle.tables.courses.notAColumn
  // @ts-expect-error Drizzle rows preserve title as string, not number
  const wrongRows: { title: number }[] = read

  // A relationship's value is whatever kind the target's id is: a session id is a uuid, a Better
  // Auth user id is text. Both are strings, so what the probe can still tell apart is a value of
  // another type altogether.
  await asas.kayan.enrollments.operations.create({ session: '0e6c6f3e-8a0f-4a5f-9d2b-3d5f9a1c2e40', student: 'a-user-id' })
  // @ts-expect-error student points at user, whose id is text
  await asas.kayan.enrollments.operations.create({ session: '0e6c6f3e-8a0f-4a5f-9d2b-3d5f9a1c2e40', student: 2 })

  const strategy = {
    name: 'probe',
    authenticate: async (_args: { headers: Headers }) => ({ user: { id: 7 } as { id: number } | null }),
  }
  const probeCourses = defineKayan({ name: 'probeCourses', fields: courses.fields, auth: strategy, targets: { service: { operations: defaultOperations } } })
  const many = buildAsas({ http: [fetchHttp()], kayan: [probeCourses] })
  buildAsas({
    http: [fetchHttp()],
    kayan: [courses],
    // @ts-expect-error buildAsas takes no auth.strategies: the kayan carries its strategy
    auth: { strategies: [strategy] },
  })
  buildAsas({
    http: [fetchHttp()],
    kayan: [courses],
    // @ts-expect-error buildAsas takes no auth.local: the kayan it authenticates carries it
    auth: { local: { kayan: courses, secret: 'type-probe-local-secret' } },
  })
  buildAsas({
    http: [fetchHttp()],
    kayan: [courses],
    // @ts-expect-error buildAsas takes no auth.betterAuth: the kayan it authenticates carries it
    auth: { betterAuth: { kayan: courses, server: () => ({}) } },
  })
  type ManyAuth = Expect<Equal<typeof many.auth.strategies, (typeof strategy)[]>>
  type ManyActor = Expect<Equal<Awaited<ReturnType<typeof many.auth.actor>>, { id: number } | null>>
  const manyUser: { id: number } | null = await many.auth.actor(new Headers())
  void manyUser
  // @ts-expect-error the actor sits under auth, so the root carries none
  many.actor
  // @ts-expect-error a build has no authenticate
  many.authenticate

  const typedLocalUsers = defineKayan({
    name: 'typedLocalUsers',
    fields: {
      ...defaultFields,
      email: { kind: 'email', rules: { required: true, unique: true } },
      nickname: { kind: 'text' },
      score: { kind: 'number' },
      hash: { kind: 'text', rules: { required: true } },
      salt: { kind: 'text', rules: { required: true } },
      sessions: { kind: 'text' },
      loginAttempts: { kind: 'number', rules: { defaultValue: 0 } },
      lockUntil: { kind: 'datetime' },
      resetPasswordToken: { kind: 'text' },
      resetPasswordAttempts: { kind: 'number', rules: { defaultValue: 0 } },
      resetPasswordExpiration: { kind: 'datetime' },
      _verified: { kind: 'checkbox', rules: { defaultValue: false } },
      _verificationToken: { kind: 'text' },
    },
    targets: { service: { operations: defaultOperations } },
  })
  const localOptions = {
    secret: 'type-probe-local-secret-of-thirty-two-characters',
    tokenExpiration: defaultTokenExpiration,
    maxLoginAttempts: defaultMaxLoginAttempts,
    lockTime: defaultLockTime,
    ip: () => null,
    email: { send: async () => {} },
  }
  // @ts-expect-error local() is refused a missing tokenExpiration
  local({ ...localOptions, tokenExpiration: undefined })
  // @ts-expect-error local() is refused a missing ip
  local({ ...localOptions, ip: undefined })
  const localTyped = defineKayan({ ...typedLocalUsers, auth: local(localOptions) })
  const localOnly = buildAsas({ http: [fetchHttp()], kayan: [localTyped] })
  const localActor = await localOnly.auth.actor(new Headers())
  const localDirect = await localOnly.auth.strategies[0]!.authenticate({ headers: new Headers() })
  type LocalDirectUser = Expect<Equal<typeof localDirect.user, Awaited<ReturnType<typeof localOnly.auth.actor>>>>
  if (localActor) {
    const strategyName: 'local' = localActor.strategy
    const kayanName: 'typedLocalUsers' = localActor.kayan
    const id: string = localActor.user.id
    const email: string = localActor.user.email
    const nickname: string | null = localActor.user.nickname
    const score: number | null = localActor.user.score
    const createdAt: Date = localActor.user.createdAt
    const updatedAt: Date = localActor.updatedAt
    // @ts-expect-error auth secrets never leave the local actor
    localActor.user.hash
    // @ts-expect-error auth salts never leave the local actor
    localActor.salt
    // @ts-expect-error sessions never leave the public local actor
    localActor.user.sessions
    // @ts-expect-error unknown local fields stay errors
    localActor.user.notAField
    // @ts-expect-error nullable text is not a number
    const wrongNickname: number = localActor.user.nickname
    void strategyName
    void kayanName
    void id
    void email
    void nickname
    void score
    void createdAt
    void updatedAt
    void wrongNickname
  }
  void localDirect
  type _LocalDirectUser = LocalDirectUser

  const betterOnly = buildAsas({
    http: [fetchHttp()],
    kayan: [
      defineKayan({
        name: 'betterCourses',
        fields: courses.fields,
        auth: betterAuth({
          server: () => ({
            api: { getSession: async () => ({ user: { id: 'better-user', role: 'admin' as const, extra: 5 } }) },
            handler: async () => new Response(),
          }),
        }),
        targets: { service: { operations: defaultOperations } },
      }),
    ],
  })
  const betterActor = await betterOnly.auth.actor(new Headers())
  if (betterActor) {
    const strategyName: 'better-auth' = betterActor.strategy
    const id: string = betterActor.user.id
    const role: 'admin' = betterActor.user.role
    const extra: number = betterActor.extra
    // @ts-expect-error role keeps the Better Auth session user type
    const wrongRole: 'member' = betterActor.user.role
    void strategyName
    void id
    void role
    void extra
    void wrongRole
  }

  const betterTyped = defineKayan({
    name: 'typedBetterUsers',
    fields: typedLocalUsers.fields,
    auth: betterAuth({
      server: () => ({
        api: { getSession: async () => ({ user: { id: 'better-user', role: 'owner' as const } }) },
        handler: async () => new Response(),
      }),
    }),
    targets: { service: { operations: defaultOperations } },
  })
  const bothAuth = buildAsas({ http: [fetchHttp()], kayan: [localTyped, betterTyped] })
  const bothActor = await bothAuth.auth.actor(new Headers())
  if (bothActor?.strategy === 'local') {
    const kayanName: 'typedLocalUsers' = bothActor.kayan
    const email: string = bothActor.user.email
    // @ts-expect-error protected field stays hidden after provider narrowing
    bothActor.user.hash
    void kayanName
    void email
  }
  if (bothActor?.strategy === 'better-auth') {
    const id: string = bothActor.user.id
    const role: 'owner' = bothActor.user.role
    void id
    void role
  }

  type BothActor = NonNullable<Awaited<ReturnType<typeof bothAuth.auth.actor>>>
  type BetterOnlyActor = Extract<BothActor, { strategy: 'better-auth' }>
  const bothStrategy = { name: 'both', authenticate: async () => ({ user: null as BothActor | null }) }
  const betterOnlyStrategy = { name: 'better-only', authenticate: async () => ({ user: null as BetterOnlyActor | null }) }
  const localOnlyStrategy = { name: 'local-only', authenticate: async () => ({ user: null as NonNullable<Awaited<ReturnType<typeof localOnly.auth.actor>>> | null }) }
  buildAsas({
    http: [fetchHttp()],
    kayan: [localTyped],
    auth: {
      admin: {
        kayan: localTyped,
        access: ({ user }: AdminAccessArgs<NonNullable<Awaited<ReturnType<typeof localOnly.auth.actor>>>>) => user.strategy === 'local',
      },
      onError: console.error,
    },
  })
  buildAsas({
    http: [fetchHttp()],
    // @ts-expect-error admin access callbacks are checked against the configured actor
    kayan: [localTyped],
    auth: { admin: { kayan: localTyped, access: (_args: AdminAccessArgs<BetterOnlyActor>) => true }, onError: console.error },
  })
  buildAsas({
    http: [fetchHttp()],
    // @ts-expect-error admin access must return a boolean or Promise<boolean>
    kayan: [localTyped],
    auth: { admin: { kayan: localTyped, access: () => 'yes' }, onError: console.error },
  })
  type CourseRow = Awaited<ReturnType<typeof asas.kayan.courses.operations.create>>
  const derivedAccess = accessFor<BothActor>()({
    update: ({ user, id, data, req }: AccessArgs<BothActor, Partial<Pick<CourseRow, 'title' | 'summary'>>, CourseRow['id']>) => {
      const uuidId: string = id!
      // @ts-expect-error id is the configured uuid id
      const wrongId: number = id
      const title: string | undefined = data?.title
      // @ts-expect-error title is text when present
      const wrongTitle: number = data?.title
      // @ts-expect-error req is optional transport context, not the verified user bag
      req.user
      if (user?.strategy === 'local') {
        const email: string = user.user.email
        // @ts-expect-error protected local field is not public
        user.user.hash
        void email
      }
      if (user?.strategy === 'better-auth') {
        const role: 'owner' = user.user.role
        // @ts-expect-error Better Auth actor in this build has no local email field under user
        user.user.email.toFixed()
        void role
      }
      void uuidId
      void wrongId
      void title
      void wrongTitle
      return true
    },
  })
  const fieldDocAccess = fieldAccessFor<BothActor>()<CourseRow, CourseRow['id']>(({ doc, data, id, user }: FieldAccessArgs<BothActor, CourseRow, CourseRow['id']>) => {
    const docFee: number | null | undefined = doc?.fee
    const dataTitle: string | undefined = data?.title
    // @ts-expect-error update input is partial; title may be absent
    const requiredDataTitle: string = data?.title
    const docTitle: string = doc!.title
    const uuidId: string | undefined = id
    if (user?.strategy === 'local') {
      const nickname: string | null = user.user.nickname
      void nickname
    }
    // @ts-expect-error no arbitrary field on course doc
    doc?.doesNotExist
    void docFee
    void dataTitle
    void requiredDataTitle
    void docTitle
    void uuidId
    return true
  })
  defineKayan({
    name: 'wrongPlainFieldCallback',
    fields: {
      // @ts-expect-error unbranded field callback cannot demand a fabricated concrete doc/id
      title: { kind: 'text', access: { update: (_args: FieldAccessArgs<BothActor, CourseRow, string>) => true } },
    },
    targets: { service: { operations: defaultOperations } },
  })
  defineKayan({
    name: 'wrongAuthUserCallback',
    fields: {
      // @ts-expect-error auth kayan field callback cannot demand a wrong provider user without a checked helper
      email: { kind: 'email', access: { read: (_args: FieldAccessArgs<BetterOnlyActor>) => true } },
    },
    targets: { service: { operations: defaultOperations } },
  })

  defineKayan({
    name: 'wrongPlainCollectionCallback',
    fields: { title: { kind: 'text' } },
    // @ts-expect-error unbranded collection callback cannot demand a fabricated string id
    access: { update: (_args: AccessArgs<BothActor, Record<string, unknown>, string>) => true },
    targets: { service: { operations: defaultOperations } },
  })
  const wrongWrappedActor = defineKayan({
    name: 'wrongWrappedActor',
    fields: { title: { kind: 'text' } },
    access: accessFor<BothActor>()({ read: (_args: AccessArgs<BetterOnlyActor>) => true }),
    targets: { service: { operations: defaultOperations } },
  })
  buildAsas({
    http: [fetchHttp()],
    // @ts-expect-error helper brand cannot hide the wrapped callback's narrower Better Auth user
    kayan: [wrongWrappedActor, defineKayan({ name: 'bothStrategyKayan', fields: { id: { kind: 'text' } }, auth: bothStrategy, targets: { service: { operations: defaultOperations } } })],
  })
  const wrongWrappedId = defineKayan({
    name: 'wrongWrappedId',
    fields: courses.fields,
    access: accessFor<BothActor>()({ update: (_args: AccessArgs<BothActor, Partial<CourseRow>, number>) => true }),
    targets: { service: { operations: defaultOperations } },
  })
  buildAsas({
    http: [fetchHttp()],
    // @ts-expect-error helper brand cannot hide a numeric id callback on a uuid-id kayan
    kayan: [wrongWrappedId, defineKayan({ name: 'bothStrategyId', fields: { id: { kind: 'text' } }, auth: bothStrategy, targets: { service: { operations: defaultOperations } } })],
  })
  const wrongAuthCollectionUsers = defineKayan({
    name: 'wrongAuthCollectionUsers',
    fields: typedLocalUsers.fields,
    access: accessFor<BothActor>()({ read: (_args: AccessArgs<BetterOnlyActor>) => true }),
    targets: { service: { operations: defaultOperations } },
  })
  buildAsas({
    http: [fetchHttp()],
    // @ts-expect-error auth kayan collection callbacks are checked against the configured local actor too
    kayan: [defineKayan({ ...wrongAuthCollectionUsers, auth: local(localOptions) }), betterTyped],
  })
  const typedCallbackKayan = defineKayan({
    name: 'typedCallbackKayan',
    fields: {
      title: { kind: 'text', access: { update: fieldDocAccess } },
    },
    access: derivedAccess,
    targets: { service: { operations: defaultOperations } },
  })
  buildAsas({
    http: [fetchHttp()],
    // @ts-expect-error field callback doc/id belongs to courses, not typedCallbackKayan
    kayan: [localTyped, betterTyped, typedCallbackKayan],
  })
  type TemplateKinds = typeof defaultKinds & ReturnType<typeof richText>['kinds'] & ReturnType<typeof storage>['kinds']
  const callbackCourses = defineKayan({
    name: 'callbackCourses',
    fields: {
      ...courses.fields,
      title: {
        ...courses.fields.title,
        access: { update: fieldAccessFor<BothActor>()<Row<(typeof courses)['fields'], { kinds: TemplateKinds }, [typeof courses]>, CourseRow['id']>(() => true) },
      },
    },
    targets: { service: { operations: defaultOperations } },
  })
  buildAsas({ http: [fetchHttp()], kayan: [{ ...callbackCourses, auth: bothStrategy }] })
  const localFieldCourses = defineKayan({
    name: 'localFieldCourses',
    fields: {
      ...courses.fields,
      title: {
        ...courses.fields.title,
        access: { update: fieldAccessFor<NonNullable<Awaited<ReturnType<typeof localOnly.auth.actor>>>>()<Row<(typeof courses)['fields'], { kinds: TemplateKinds }, [typeof courses]>, CourseRow['id']>(() => true) },
      },
    },
    targets: { service: { operations: defaultOperations } },
  })
  const betterOnlyCarrier = defineKayan({ name: 'betterOnlyCarrier', fields: { id: { kind: 'text' } }, auth: betterOnlyStrategy, targets: { service: { operations: defaultOperations } } })
  buildAsas({
    http: [fetchHttp()],
    // @ts-expect-error field callbacks typed for local auth cannot be built with Better Auth only
    kayan: [localFieldCourses, betterOnlyCarrier],
  })
  const localOnlyBound = defineKayan({
    name: 'localOnlyBound',
    fields: { ...defaultFields, title: { kind: 'text' } },
    access: accessFor<NonNullable<Awaited<ReturnType<typeof localOnly.auth.actor>>>>()({
      read: ({ user }: AccessArgs<NonNullable<Awaited<ReturnType<typeof localOnly.auth.actor>>>>) => user?.strategy === 'local',
    }),
    targets: { service: { operations: defaultOperations } },
  })
  buildAsas({ http: [fetchHttp()], kayan: [localOnlyBound, defineKayan({ name: 'localOnlyCarrier', fields: { id: { kind: 'text' } }, auth: localOnlyStrategy, targets: { service: { operations: defaultOperations } } })] })
  buildAsas({
    http: [fetchHttp()],
    // @ts-expect-error access callbacks typed for local auth cannot be built with Better Auth only
    kayan: [localOnlyBound, betterOnlyCarrier],
  })


  const betterOnlyBound = defineKayan({
    name: 'betterOnlyBound',
    fields: { title: { kind: 'text' } },
    access: accessFor<BetterOnlyActor>()({ read: ({ user }: AccessArgs<BetterOnlyActor>) => user?.strategy === 'better-auth' }),
    targets: { service: { operations: defaultOperations } },
  })
  buildAsas({
    http: [fetchHttp()],
    // @ts-expect-error both-provider actors are not accepted by per-kayan provider-only callbacks
    kayan: [localOnlyBound, betterOnlyBound, defineKayan({ name: 'bothStrategyBound', fields: { id: { kind: 'text' } }, auth: bothStrategy, targets: { service: { operations: defaultOperations } } })],
  })

  // A build whose kayan carry no provider at all is driven by whatever actor its host resolves, so
  // its actor is open: the strategy loop answers `null` for it whatever the type says.
  const disabledAuth = buildAsas({ http: [fetchHttp()], kayan: [courses] })
  type DisabledActor = Expect<Equal<Awaited<ReturnType<typeof disabledAuth.auth.actor>>, unknown>>

  const courseId = '0e6c6f3e-8a0f-4a5f-9d2b-3d5f9a1c2e40'
  await asas.kayan.sessions.operations.create({ course: courseId, startsAt: new Date(), capacity: 12 })
  await asas.kayan.sessions.operations.create({ course: courseId, startsAt: new Date(), capacity: null })

  // @ts-expect-error startsAt is a date, not a number
  await asas.kayan.sessions.operations.create({ course: courseId, startsAt: 5 })

  // @ts-expect-error course is required and nothing fills it
  await asas.kayan.sessions.operations.create({ startsAt: new Date() })

  // @ts-expect-error there is no such field
  await asas.kayan.sessions.operations.create({ course: 1, startsAt: new Date(), teacher: 'Layla' })

  // @ts-expect-error there is no such kayan
  await asas.kayan.students.operations.create({})

  await asas.kayan.courses.operations.create({ title: 'Tajweed', fee: 40, sessions: [{ startsAt: new Date() }] })
  // @ts-expect-error a key the derived create shape does not name is refused
  await asas.kayan.courses.operations.create({ title: 'Tajweed', titel: 'Tajweed' })
  // @ts-expect-error a required column with no default is required on create
  await asas.kayan.courses.operations.create({ fee: 40 })
  // @ts-expect-error the fee column is a number, whatever the operation adds
  await asas.kayan.courses.operations.create({ title: 'Tajweed', fee: 'free' })

  const course = await asas.kayan.courses.operations.create({ title: 'Tajweed' })
  const id: string = course.id
  const createdAt: Date = course.createdAt
  const fee: number | null = course.fee

  await asas.kayan.courses.operations.update({ id: course.id, title: 'Tajweed, second term' })
  await asas.kayan.courses.operations.update({ id: course.id, summary: null })
  await asas.kayan.courses.operations.delete({ id: course.id })
  // @ts-expect-error `delete` takes an object, never a bare id
  await asas.kayan.courses.operations.delete(course.id)
  // @ts-expect-error an id never accepts null
  await asas.kayan.sessions.operations.create({ id: null, course: 1, startsAt: new Date() })
  // @ts-expect-error the update id never accepts null
  await asas.kayan.courses.operations.update({ id: null, summary: null })
  // @ts-expect-error a required field never accepts null
  await asas.kayan.courses.operations.update({ id: course.id, title: null })
  // @ts-expect-error a required field with a default is optional on create, but never nullable
  await asas.kayan.sessions.operations.create({ course: 1, startsAt: new Date(), createdAt: null })
  // @ts-expect-error a required field with a default never accepts null on update
  await asas.kayan.courses.operations.update({ id: course.id, createdAt: null })
  // @ts-expect-error the id is a number, and an update needs one
  await asas.kayan.courses.operations.update({ title: 'Tajweed' })

  await asas.kayan.courses.operations.archive({ id: course.id, reason: 'duplicate' })
  // @ts-expect-error the schema asks for a reason
  await asas.kayan.courses.operations.archive({ id: course.id })
  // @ts-expect-error sessions declares no archive operation
  await asas.kayan.sessions.operations.archive({ id: 1, reason: 'duplicate' })

  const step: Step = (ctx) => {
    // @ts-expect-error there is no ctx.db
    const database = ctx.db
    return { ...ctx, data: { ...ctx.data, database } }
  }

  const readOnlyStep: ReadStep = (ctx, tools) => {
    // @ts-expect-error read tools have no write store
    tools.store
    return ctx
  }
  const readValidator: ReadStep = validate
  const writeValidator: WriteStep = validate
  const commonSchema = (tools: CommonTools) => tools.schema
  const commonReadStep: ReadStep = (ctx, tools) => {
    commonSchema(tools)
    return ctx
  }
  const commonWriteStep: WriteStep = (ctx, tools) => {
    commonSchema(tools)
    return ctx
  }
  const narrowedStep: Step = (ctx, tools) => {
    if (tools.effect === 'read') {
      tools.read(ctx.data)
      // @ts-expect-error read tools have no write store after narrowing
      tools.store
    } else {
      tools.store.insert
      // @ts-expect-error write tools have no managed read fetcher after narrowing
      tools.read
    }
    return ctx
  }
  defineKayan({
    name: 'mixedSteps',
    fields: {},
    targets: {
      service: {
        operations: {
          ...defaultOperations,
          // @ts-expect-error a list is all read steps or all write steps, never both
          inspect: { steps: [findOne, insert] },
        },
      },
    },
  })

  await asas.kayan.courses.operations.create(
    { title: 'Tajweed' },
    {
      actor: {
        id: 'u1',
        createdAt: new Date(),
        updatedAt: new Date(),
        email: 'u1@example.com',
        emailVerified: false,
        name: 'U One',
        collection: 'user',
        strategy: 'better-auth',
        user: {
          id: 'u1',
          createdAt: new Date(),
          updatedAt: new Date(),
          email: 'u1@example.com',
          emailVerified: false,
          name: 'U One',
        },
      },
      context: { source: 'probe' },
    },
  )

  const privateNotes = defineKayan({
    name: 'privateNotes',
    access: { create: () => true, read: () => true, update: () => true, delete: () => true },
    fields: {
      ...defaultFields,
      title: { kind: 'text', rules: { required: true } },
      secret: { kind: 'text', access: { read: () => false } },
    },
    targets: { service: { operations: defaultOperations } },
  })
  const privateAsas = buildAsas({ http: [fetchHttp()], kayan: [privateNotes] })
  const privateRow = await privateAsas.kayan.privateNotes.operations.create({ title: 'typed', secret: 'hidden' })
  const optionalSecret: string | null | undefined = privateRow.secret
  // @ts-expect-error read-protected fields are optional on public rows
  const requiredSecret: string | null = privateRow.secret
  const privatePage = await privateAsas.kayan.privateNotes.operations.find({ limit: 1, where: { title: { equals: 'typed' } } })
  const privateDoc = await privateAsas.kayan.privateNotes.operations.findByID({ id: privateRow.id })
  // @ts-expect-error `findByID` takes an object, never a bare id
  await privateAsas.kayan.privateNotes.operations.findByID(privateRow.id)
  const totalDocs: number = (await privateAsas.kayan.privateNotes.operations.count()).totalDocs
  const optionalFromFind: string | null | undefined = privatePage.docs[0]?.secret
  const optionalFromFindByID: string | null | undefined = privateDoc?.secret
  // @ts-expect-error public rows do not grow arbitrary fields
  privateRow.nope

  return {
    id,
    createdAt,
    fee,
    first,
    readTitle,
    readFee,
    step,
    readOnlyStep,
    readValidator,
    writeValidator,
    commonReadStep,
    commonWriteStep,
    narrowedStep,
    wrongRows,
    wrongRuleHandlers,
  }
}

const tenancyLanguage = defineMithaq({
  arkan: [base],
  targets: {
    drizzle: drizzleAdapter({ connectionString: 'postgresql://never-connected', kinds: drizzleKinds, rules: drizzleRules, push: false }),
    zod: zodTarget,
    rbac: rbacTarget({ roles: systemRoles, access: { '*': { read: true } }, kayan: { roles: 'roles', memberRoles: 'memberRoles' } }),
    service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'drizzle', schema: 'zod', authorize: defaultAuthorize }),
  },
})
type LanguageRowsAreCompiled = Expect<Equal<(typeof tenancyLanguage)['targets']['rbac']['access']['*']['read'], true>>

const earlyActor = userRefs<OrganizationActor>()
const earlyTenant = { organization: { equals: earlyActor.activeOrganizationId } }
void earlyTenant
// @ts-expect-error "activeOrganisationId" is not a key of this project's actor
void earlyActor.activeOrganisationId

defineKayan({ name: 'defaultedProbe', fields: { code: { kind: 'text', rules: { defaultValue: actor.activeOrganizationId } } }, targets: { service: { operations: defaultOperations } } })
defineKayan({
  name: 'wrongDefaultProbe',
  // @ts-expect-error the actor's organization list is not a text field's value
  fields: { code: { kind: 'text', rules: { defaultValue: actor.organizationIds } } },
  targets: { service: { operations: defaultOperations } },
})

const everyRoleRow = defineKayan({
  name: 'everyRoleRow',
  fields: { title: { kind: 'text' } },
  access: rows({ '*': { read: true }, instructor: { read: true } }),
  targets: { service: { operations: defaultOperations } },
})
const governanceRoleRow = defineKayan({
  name: 'governanceRoleRow',
  fields: { title: { kind: 'text' } },
  // @ts-expect-error "admin" is Better Auth's governance name, and no system role of this project
  access: rows({ admin: { read: true } }),
  targets: { service: { operations: defaultOperations } },
})

const rowCourses = defineKayan({
  name: 'rowCourses',
  fields: { ...defaultFields, organization: tenant.field, title: { kind: 'text' }, fee: { kind: 'number' } },
  access: rows({
    instructor: {
      read: { organization: { equals: actor.activeOrganizationId } },
      fields: ['*', '!fee'],
    },
  }),
  targets: { service: { operations: defaultOperations } },
})

const rowSessions = defineKayan({
  name: 'rowSessions',
  fields: { course: { kind: 'relationship', relationTo: () => rowCourses } },
  access: rows({ instructor: { read: { 'course.title': { contains: 'Tajweed' } } } }),
  targets: { service: { operations: defaultOperations } },
})

const misspelledRowField = defineKayan({
  name: 'misspelledRowField',
  fields: { title: { kind: 'text' } },
  // @ts-expect-error "titel" is not a field of this kayan
  access: rows({ instructor: { read: { titel: { equals: 'x' } } } }),
  targets: { service: { operations: defaultOperations } },
})

const misspelledRowHop = defineKayan({
  name: 'misspelledRowHop',
  fields: { course: { kind: 'relationship', relationTo: () => rowCourses } },
  // @ts-expect-error "course.titel" is not a field of the kayan the hop reaches
  access: rows({ instructor: { read: { 'course.titel': { equals: 'x' } } } }),
  targets: { service: { operations: defaultOperations } },
})

// A locale is not a path an access row may name. `Paths` grows a dotted arm for a relationship
// alone, so a localized field's locale key is `never` in the row's `Where` and the row is refused
// where it is written rather than when the compiled `Where` runs.
const localeRowPath = defineKayan({
  name: 'localeRowPath',
  fields: { title: { kind: 'text', label: { ar: 'العنوان', en: 'Title' }, rules: { localized: true } } },
  // @ts-expect-error "title.ar" is not a path a row may name; only a relationship grows a dotted one
  access: rows({ instructor: { read: { 'title.ar': { equals: 'x' } } } }),
  targets: { service: { operations: defaultOperations } },
})

const misspelledRowRole = defineKayan({
  name: 'misspelledRowRole',
  fields: { title: { kind: 'text' } },
  // @ts-expect-error "membr" is not one of the language's roles
  access: rows({ membr: { read: true } }),
  targets: { service: { operations: defaultOperations } },
})

const misspelledRowExclusion = defineKayan({
  name: 'misspelledRowExclusion',
  fields: { title: { kind: 'text' }, fee: { kind: 'number' } },
  // @ts-expect-error "!fe" is not a field of this kayan, and "!fee" is
  access: rows({ instructor: { fields: ['*', '!fe'] } }),
  targets: { service: { operations: defaultOperations } },
})

// `create` is a boolean: the runner allows a create only on `true`, so a filter there would read as
// a grant and deny every write.
const filteredRowCreate = defineKayan({
  name: 'filteredRowCreate',
  fields: { title: { kind: 'text' } },
  // @ts-expect-error a create answer is a boolean, never a Where
  access: rows({ instructor: { create: { title: { equals: 'x' } } } }),
  targets: { service: { operations: defaultOperations } },
})

const emptyRowWhere = defineKayan({
  name: 'emptyRowWhere',
  fields: { title: { kind: 'text' } },
  // @ts-expect-error an empty Where is not a constraint
  access: rows({ instructor: { read: {} } }),
  targets: { service: { operations: defaultOperations } },
})

const misspelledActorKey = defineKayan({
  name: 'misspelledActorKey',
  fields: { title: { kind: 'text' } },
  // @ts-expect-error "activeOrganisationId" is not a key of this language's actor
  access: rows({ instructor: { read: { tenant: { equals: actor.activeOrganisationId } } } }),
  targets: { service: { operations: defaultOperations } },
})

const wrongActorValue = defineKayan({
  name: 'wrongActorValue',
  fields: { title: { kind: 'text' }, fee: { kind: 'number' } },
  // @ts-expect-error the actor's organization id is a string, and "fee" is a number
  access: rows({ instructor: { read: { fee: { equals: actor.activeOrganizationId } } } }),
  targets: { service: { operations: defaultOperations } },
})

const actorList = defineKayan({
  name: 'actorList',
  fields: { title: { kind: 'text' } },
  access: rows({ instructor: { read: { title: { in: actor.organizationIds } } } }),
  targets: { service: { operations: defaultOperations } },
})

const actorListOperator = defineKayan({
  name: 'actorListOperator',
  fields: { title: { kind: 'text' } },
  // @ts-expect-error a list of the actor's values is what "in" takes, not "equals"
  access: rows({ instructor: { read: { title: { equals: actor.organizationIds } } } }),
  targets: { service: { operations: defaultOperations } },
})

const actorScalarList = defineKayan({
  name: 'actorScalarList',
  fields: { title: { kind: 'text' } },
  // @ts-expect-error "in" takes a list of the field's values, not one of them
  access: rows({ instructor: { read: { title: { in: actor.activeOrganizationId } } } }),
  targets: { service: { operations: defaultOperations } },
})

export type LanguageProbes = [LanguageRowsAreCompiled]

export const rowProbes = {
  everyRoleRow,
  governanceRoleRow,
  actorListOperator,
  actorScalarList,
  misspelledActorKey,
  wrongActorValue,
  actorList,
  rowCourses,
  rowSessions,
  localeRowPath,
  misspelledRowField,
  misspelledRowHop,
  misspelledRowRole,
  misspelledRowExclusion,
  filteredRowCreate,
  emptyRowWhere,
}

type GlobalRow = Awaited<ReturnType<typeof asas.global.settings.operations.findOne>>
type GlobalFindOneIsNullable = Expect<Equal<Extract<GlobalRow, null>, null>>
type GlobalContactEmail = Expect<Equal<NonNullable<GlobalRow>['contactEmail'], string | null>>
type GlobalMaintenance = Expect<Equal<NonNullable<GlobalRow>['maintenance'], boolean | null>>
type GlobalTypeColumn = Expect<Equal<NonNullable<GlobalRow>['globalType'], string>>

type GlobalUpdateData = NonNullable<Parameters<typeof asas.global.settings.operations.update>[0]>
type GlobalUpdateIsPartial = Expect<Equal<{} extends GlobalUpdateData ? true : false, true>>
type GlobalUpdateContactEmail = Expect<Equal<GlobalUpdateData['contactEmail'], string | null | undefined>>
type GlobalUpdateMaintenance = Expect<Equal<GlobalUpdateData['maintenance'], boolean | null | undefined>>
type GlobalUpdateHasNoId = Expect<Equal<'id' extends keyof GlobalUpdateData ? true : false, false>>
type GlobalReadInput = Expect<Equal<Parameters<typeof asas.global.settings.operations.findOne>[0], { depth?: number } | undefined>>

// @ts-expect-error a global has no create operation
type NoGlobalCreate = (typeof asas.global.settings.operations)['create']
// @ts-expect-error a global has no findByID operation
type NoGlobalFindByID = (typeof asas.global.settings.operations)['findByID']
// @ts-expect-error a global is reached under asas.global, never asas.kayan
type NoGlobalOnKayan = (typeof asas.kayan)['settings']
type GlobalName = Expect<Equal<keyof typeof asas.global, 'settings'>>
type GlobalIsSingle = Expect<Equal<(typeof settings)['single'], true>>

// A kayan's relationship may point at a global, so the built kayan record is typed against every
// declared thing rather than the kayan list alone. With the kayan list alone the target is not in
// the registry, the id resolves to `never` and the column collapses to `null | undefined`, which no
// id can be written to.
const globalLink = defineKayan({
  name: 'globalLink',
  fields: { settings: { kind: 'relationship', relationTo: () => settings } },
  targets: { service: { operations: defaultOperations } },
})
const globalLinkAsas = buildAsas({ http: [fetchHttp()], kayan: [globalLink], global: [settings] })
type GlobalRelationshipColumn = NonNullable<Parameters<typeof globalLinkAsas.kayan.globalLink.operations.create>[0]>['settings']
type GlobalRelationshipIsTyped = Expect<Equal<GlobalRelationshipColumn, string | null | undefined>>

const globalCreateAccess = defineGlobal({
  name: 'globalCreateAccess',
  fields: { title: { kind: 'text' }, ...defaultGlobalFields },
  // @ts-expect-error a global's access is read and update only
  access: { create: () => true, read: () => true },
  targets: { service: { operations: defaultGlobalOperations } },
})
defineGlobal({
  name: 'globalStrayOperationKey',
  fields: { title: { kind: 'text' }, ...defaultGlobalFields },
  // @ts-expect-error `bogus` is no key of an operation declaration, on a global as on any kayan
  targets: { service: { operations: { ...defaultGlobalOperations, update: { ...defaultGlobalOperations.update, bogus: 1 } } } },
})
const globalOverDefaults = defineGlobal({
  name: 'globalOverDefaults',
  fields: ({ defaults }) => ({ ...defaults, title: { kind: 'text', label: { en: 'Title', ar: 'العنوان' } } }),
  targets: { service: { operations: ({ defaults }) => defaults } },
})
type GlobalOverDefaultsOperations = Expect<Equal<keyof (typeof globalOverDefaults)['targets']['service']['operations'], keyof typeof defaultGlobalOperations>>
defineGlobal({
  name: 'globalStrayReturnedKey',
  fields: ({ defaults }) => defaults,
  targets: {
    service: {
      // @ts-expect-error `bogus` is no key of an operation declaration, in a returned object too
      operations: ({ defaults }) => ({ ...defaults, update: { ...defaults.update, bogus: 1 } }),
    },
  },
})

export type GlobalProbes = [
  GlobalFindOneIsNullable,
  GlobalContactEmail,
  GlobalMaintenance,
  GlobalTypeColumn,
  GlobalUpdateIsPartial,
  GlobalUpdateContactEmail,
  GlobalUpdateMaintenance,
  GlobalUpdateHasNoId,
  GlobalName,
  GlobalIsSingle,
  GlobalRelationshipIsTyped,
]

export const globalProbes = { globalCreateAccess }

// Every case below fails the day an operation's input or its result is erased again: with `unknown`
// in either place, the key reads become errors and the `@ts-expect-error` lines stop being errors.
// place, the key reads become errors and the `@ts-expect-error` lines stop
// being errors.
type Procedures = NonNullable<(typeof asas.operations)['procedures']>

type CourseCreateInput = Parameters<Procedures['courses']['create']>[0]
type ProcedureCreateTakesTitle = Expect<Equal<CourseCreateInput['title'], string>>
type ProcedureCreateIsTheBoundInput = Expect<
  Equal<CourseCreateInput, Parameters<typeof asas.kayan.courses.operations.create>[0]>
>
type ProcedureCreateWidens = Expect<
  Equal<NonNullable<CourseCreateInput['sessions']>[number]['startsAt'], Date>
>
// @ts-expect-error the published input refuses a key no field and no validate function declares
const procedureCreateStrict: CourseCreateInput = { title: 'Tajweed', titel: 'Tajweed' }

type ProcedureCreateAnswersRow = Expect<
  Equal<Awaited<ReturnType<Procedures['courses']['create']>>['title'], string>
>
type ProcedureArchiveInput = Expect<
  Equal<Parameters<Procedures['courses']['archive']>[0], { id: string; reason: string }>
>
type ProcedureFindWithSessions = Expect<
  Equal<
    NonNullable<Awaited<ReturnType<Procedures['courses']['findWithSessions']>>>['sessions'],
    { id: string; startsAt: Date; capacity: number | null; venue?: string | null | undefined; format?: string | null | undefined; archived?: boolean | null | undefined; seatsLeft: number | null }[]
  >
>
type CountProcedure = Expect<Equal<Awaited<ReturnType<Procedures['courses']['count']>>, { totalDocs: number }>>
type ProcedureGlobalUpdateInput = Parameters<Procedures['settings']['update']>[0]
type ProcedureGlobalUpdateHasNoId = Expect<
  Equal<'id' extends keyof ProcedureGlobalUpdateInput ? true : false, false>
>
type ProcedureGlobalUpdateContactEmail = Expect<Equal<ProcedureGlobalUpdateInput['contactEmail'], string | null | undefined>>
type ProcedureGlobalFindOne = Expect<
  Equal<NonNullable<Awaited<ReturnType<Procedures['settings']['findOne']>>>['contactEmail'], string | null>
>
// @ts-expect-error a global runs findOne and update alone
type NoGlobalDeleteProcedure = Procedures['settings']['delete']

// Every case above refuses one name someone thought to write down, so none of them catches the
// opposite gap: a name the static view carries that no built operation answers. These two pin the
// whole key set instead.
type ProcedureNamesAreTheTable = Expect<
  Equal<
    keyof Procedures['courses'],
    'create' | 'update' | 'delete' | 'updateMany' | 'deleteMany' | 'find' | 'findByID' | 'count' | 'archive' | 'unarchive' | 'unpublish' | 'findWithSessions' | 'findVersions' | 'findVersionByID' | 'restoreVersion'
  >
>
type GlobalProcedureNamesAreTheTable = Expect<Equal<keyof Procedures['settings'], 'findOne' | 'update'>>

// `typeof asas.router` builds a typed client with no codegen, which both consumer apps depend on. A
// router typed `Record<string, Record<string, unknown>>` is not an `AnyRouter`, so this line alone
// fails if the router erases again.
type Client = RouterClient<typeof asas.router>
type ClientCreateInput = Parameters<Client['courses']['create']>[0]
type ClientCreateTakesTitle = Expect<Equal<ClientCreateInput['title'], string>>
type ClientCreateAnswersRow = Expect<
  Equal<Awaited<ReturnType<Client['courses']['create']>>['title'], string>
>
// @ts-expect-error the client refuses a key the published input does not name
const clientCreateStrict: ClientCreateInput = { title: 'Tajweed', titel: 'Tajweed' }

export type ProcedureProbes = [
  ProcedureNamesAreTheTable,
  GlobalProcedureNamesAreTheTable,
  ProcedureCreateTakesTitle,
  ProcedureCreateIsTheBoundInput,
  ProcedureCreateWidens,
  ProcedureCreateAnswersRow,
  ProcedureArchiveInput,
  ProcedureFindWithSessions,
  ProcedureGlobalUpdateHasNoId,
  ProcedureGlobalUpdateContactEmail,
  ProcedureGlobalFindOne,
  ClientCreateTakesTitle,
  ClientCreateAnswersRow,
]

export const procedureProbes = { procedureCreateStrict, clientCreateStrict }

// Inside a function no one calls, because the client is declared and not built.
export const fetchClientProbes = (client: FetchClient<typeof asas.router>) => {
  const counted = client({ kayan: 'courses', operation: 'count', input: {} })
  const created = client({ kayan: 'courses', operation: 'create', input: { title: 'Tajweed' } })
  // @ts-expect-error the build has no kayan `coursez`
  void client({ kayan: 'coursez', operation: 'count', input: {} })
  // @ts-expect-error `courses` has no operation `publish`
  void client({ kayan: 'courses', operation: 'publish', input: {} })
  // @ts-expect-error the create input names no `titel`
  void client({ kayan: 'courses', operation: 'create', input: { title: 'Tajweed', titel: 'Tajweed' } })
  void (null as unknown as FetchClient)({ kayan: 'anything', operation: 'whatever', input: { any: 1 } })
  return [counted, created] as const
}
type FetchClientAnswers = ReturnType<typeof fetchClientProbes>
type FetchClientCountAnswersTotal = Expect<Equal<Awaited<FetchClientAnswers[0]>, { totalDocs: number }>>
type FetchClientCreateAnswersRow = Expect<Equal<Awaited<FetchClientAnswers[1]>['title'], string>>
// The output side of `SchemaOf` reads a `Date` as `Date`, as the operation returns it in process.
type FetchClientCreateAnswersDate = Expect<Equal<Awaited<FetchClientAnswers[1]>['createdAt'], Date>>
export type FetchClientProbes = [FetchClientCountAnswersTotal, FetchClientCreateAnswersRow, FetchClientCreateAnswersDate]

// A field the client does not supply for an operation is not a key of that operation's input, so a
// caller cannot be told by the type checker to send what the shape will refuse.
type SupplierFields = {
  id: { kind: 'number' }
  body: { kind: 'text'; rules: { required: true } }
  ref: { kind: 'text'; rules: { providedBy: { create: 'application'; update: 'client' } } }
  seal: { kind: 'text'; rules: { providedBy: { create: 'client'; update: 'never' } } }
}
type SuppliedCreateKeys = keyof CreateOf<SupplierFields, 'zod'>
type SuppliedUpdateKeys = keyof UpdateOf<SupplierFields, 'zod'>
type CreateDropsTheApplicationsField = Expect<Equal<SuppliedCreateKeys, 'id' | 'body' | 'seal'>>
type UpdateDropsTheFieldNobodySupplies = Expect<Equal<SuppliedUpdateKeys, 'id' | 'body' | 'ref'>>
// @ts-expect-error the application supplies `ref` on create, so no create input names it
const noRefOnCreate: SuppliedCreateKeys = 'ref'
// @ts-expect-error nobody supplies `seal` on update, so no update input names it
const noSealOnUpdate: SuppliedUpdateKeys = 'seal'

export type SupplierProbes = [CreateDropsTheApplicationsField, UpdateDropsTheFieldNobodySupplies]
export const supplierProbes = { noRefOnCreate, noSealOnUpdate }

// A label is `Readonly<Record<Locale, string>>`, so every declared locale is required and adding a
// locale breaks each label until each carries it.
const localeTargets = {
  drizzle: drizzleAdapter({ connectionString: 'postgresql://never-connected', kinds: drizzleKinds, rules: drizzleRules, push: false }),
  zod: zodTarget,
} as const
const bilingual = defineMithaq({
  locales: ['ar', 'en'] as const,
  arkan: [base],
  targets: { ...localeTargets, service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'drizzle', schema: 'zod', authorize: defaultAuthorize }) },
})
type BilingualLabel = Expect<Equal<Localized<LocalesOf<typeof bilingual>>, Readonly<Record<'ar' | 'en', string>>>>
bilingual.defineKayan({
  name: 'bilingualProbe',
  fields: { title: { kind: 'text', label: { ar: 'العنوان', en: 'Title' } } },
  targets: { service: { operations: defaultOperations } },
})
bilingual.defineKayan({
  name: 'halfTranslatedProbe',
  // @ts-expect-error a label that omits the declared "ar" locale is refused where it is written
  fields: { title: { kind: 'text', label: { en: 'Title' } } },
  targets: { service: { operations: defaultOperations } },
})
// @ts-expect-error "fr" is not one of this language's locales
const undeclaredLocale: Localized<LocalesOf<typeof bilingual>> = { ar: 'العنوان', en: 'Title', fr: 'Titre' }
// Inside `defineKayan` a generic constraint check does no excess-property checking of its own. The
// stray-key intersection that refuses a key the language never named on a field refuses, beside it,
// a locale the language never named on a label.
bilingual.defineKayan({
  name: 'undeclaredLocaleProbe',
  // @ts-expect-error "fr" is not one of this language's locales
  fields: { title: { kind: 'text', label: { ar: 'العنوان', en: 'Title', fr: 'Titre' } } },
  targets: { service: { operations: defaultOperations } },
})
bilingual.defineGlobal({
  name: 'undeclaredLocaleGlobalProbe',
  // @ts-expect-error a global's fields are checked the same way a kayan's are
  fields: { title: { kind: 'text', label: { ar: 'العنوان', en: 'Title', fr: 'Titre' } }, ...defaultGlobalFields },
  targets: { service: { operations: defaultGlobalOperations } },
})

const trilingual = defineMithaq({
  locales: ['ar', 'en', 'fr'] as const,
  arkan: [base],
  targets: { ...localeTargets, service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'drizzle', schema: 'zod', authorize: defaultAuthorize }) },
})
type TrilingualLabel = Expect<Equal<Localized<LocalesOf<typeof trilingual>>, Readonly<Record<'ar' | 'en' | 'fr', string>>>>
trilingual.defineKayan({
  name: 'trilingualProbe',
  fields: { title: { kind: 'text', label: { ar: 'العنوان', en: 'Title', fr: 'Titre' } } },
  targets: { service: { operations: defaultOperations } },
})
trilingual.defineKayan({
  name: 'trilingualGapProbe',
  // @ts-expect-error the language declares "fr", so a label in two locales is not enough
  fields: { title: { kind: 'text', label: { ar: 'العنوان', en: 'Title' } } },
  targets: { service: { operations: defaultOperations } },
})

// A language that declares no locales keeps the open shape, so a project that never names a locale
// writes whatever keys it likes. That is the absent key, which is the only spelling the `string`
// fallback fires for.
type OpenLabel = Expect<Equal<Localized<LocalesOf<typeof plainLanguage>>, Readonly<Record<string, string>>>>
// The key declared empty is the other spelling, and it infers `never`, so a label has no key at all
// rather than any key. Both reach `mithaq generate messages` with no locale, which is why it
// refuses on the list rather than on the type.
type EmptyLabel = Expect<Equal<Localized<LocalesOf<{ locales: readonly [] }>>, Readonly<Record<never, string>>>>
plainLanguage.defineKayan({
  name: 'openLabelProbe',
  fields: { title: { kind: 'text', label: { fr: 'Titre' } } },
  targets: { service: { operations: defaultOperations } },
})

defineKayan({
  name: 'projectLabelProbe',
  // @ts-expect-error this project declared "ar", and this label omits it
  fields: { title: { kind: 'text', label: { en: 'Title' } } },
  targets: { service: { operations: defaultOperations } },
})

export type LocaleProbes = [BilingualLabel, TrilingualLabel, OpenLabel, EmptyLabel]
export const localeProbes = { undeclaredLocale }

// A store reaches local auth by declaring `sql`, never by happening to carry a `db` and a `tables`.
// The second store in this package holds rows and declares no client, so it is refused where the
// drizzle adapter is taken.
const impostorStore = {
  ...memoryStore(),
  db: undefined as unknown as ReturnType<typeof drizzleAdapter>['db'],
  tables: {} as ReturnType<typeof drizzleAdapter>['tables'],
}
const developmentOptions = { development: true, tokenExpiration: defaultTokenExpiration, maxLoginAttempts: defaultMaxLoginAttempts, lockTime: defaultLockTime, ip: () => null }
localAuthStrategy({
  options: developmentOptions,
  kayan: undefined as unknown as ResolvedKayan,
  // @ts-expect-error a store carrying a db and tables but declaring no `sql` is not a local auth target
  target: impostorStore,
  writes: {},
  projectUser: async (row) => row,
  onError: console.error,
})
localAuthStrategy({ options: developmentOptions, kayan: undefined as unknown as ResolvedKayan, target: { ...impostorStore, sql: 'drizzle' as const }, writes: {}, projectUser: async (row) => row, onError: console.error })
// `projectUser` is required, because an identity there would hand every field to a caller that
// bypasses `buildAsas`.
// @ts-expect-error a strategy naming no projectUser
localAuthStrategy({ options: developmentOptions, kayan: undefined as unknown as ResolvedKayan, target: { ...impostorStore, sql: 'drizzle' as const }, writes: {}, onError: console.error })
// @ts-expect-error an access target naming no kayan
rbacTarget({ roles: systemRoles })
// @ts-expect-error an access target naming no assignment kayan
rbacTarget({ roles: systemRoles, kayan: { roles: 'roles' } })
localAuthStrategy({
  options: developmentOptions,
  kayan: undefined as unknown as ResolvedKayan,
  target: drizzleAdapter({ connectionString: 'postgresql://never-connected', kinds: drizzleKinds, rules: drizzleRules }),
  writes: {},
  projectUser: async (row) => row,
  onError: console.error,
})

// A label written as a function is the hatch a project with its own translation runtime takes, so
// it is accepted beside the record and the stray-key intersection leaves it alone rather than
// mapping `Function`'s own members to `never`.
bilingual.defineKayan({
  name: 'labelFunctionProbe',
  fields: { title: { kind: 'text', label: () => 'whatever the project resolved' } },
  targets: { service: { operations: defaultOperations } },
})
bilingual.defineKayan({
  name: 'nestedMessageProbe',
  messages: { error: { forbidden: { ar: 'ممنوع', en: 'Forbidden' } }, singular: { ar: 'ملاحظة', en: 'Note' } },
  fields: { title: { kind: 'text', label: { ar: 'العنوان', en: 'Title' } } },
  targets: { service: { operations: defaultOperations } },
})
// A locale written as a getter that never returns is a legal declaration. The return type has to be
// written: a getter whose body only throws infers `void` rather than `never`, and `void` is refused
// here.
bilingual.defineKayan({
  name: 'throwingMessageGetterProbe',
  messages: { title: { get ar(): string { throw new Error('x') }, get en(): string { throw new Error('x') } } },
  fields: { title: { kind: 'text', label: { ar: 'العنوان', en: 'Title' } } },
  targets: { service: { operations: defaultOperations } },
})
bilingual.defineKayan({
  name: 'shortMessageProbe',
  // @ts-expect-error the language declares "ar" and this message carries none
  messages: { error: { forbidden: { en: 'Forbidden' } } },
  fields: { title: { kind: 'text', label: { ar: 'العنوان', en: 'Title' } } },
  targets: { service: { operations: defaultOperations } },
})
bilingual.defineKayan({
  name: 'strayMessageLocaleProbe',
  // @ts-expect-error "fr" is not one of this language's locales
  messages: { error: { forbidden: { ar: 'ممنوع', en: 'Forbidden', fr: 'Interdit' } } },
  fields: { title: { kind: 'text', label: { ar: 'العنوان', en: 'Title' } } },
  targets: { service: { operations: defaultOperations } },
})

bilingual.buildAsas({
  http: [fetchHttp()],
  kayan: [bilingual.defineKayan({ name: 'resolverShapeProbe', fields: { title: { kind: 'text', label: { ar: 'العنوان', en: 'Title' } } }, targets: { service: { operations: defaultOperations } } })],
  // @ts-expect-error the language names seven kinds and this object names one
  messages: () => ({ kinds: { text: 'Text' }, fields: { id: 'ID' }, globalType: 'Global type' }),
})

// A screen types every component name a field writes under it, the way `locales` types every label
// and `roles` every role key: a name the screen never registered, and that the registry does not
// ship, is refused where it is written.
// A reference is a `ui()` URL off a folder, and only `folderOf` makes one.
const probeUi = folderOf(new URL('./ui-dashboard/', import.meta.url))
// @ts-expect-error a plain URL is no reference: only folderOf makes one
const plainRef: import('mithaq').Ui = new URL('./ui-dashboard/money.tsx#Money', import.meta.url)
// @ts-expect-error a reference names an export after #
probeUi('money.tsx')
const withComponents = defineMithaq({
  locales: ['ar', 'en'] as const,
  arkan: [base],
  targets: {
    ...localeTargets,
    dashboard: screenTarget({
      path: '/dashboard',
      kayan: [],
      controls: screenKinds,
      providers: [],
      pages: { dashboard: { path: '/', component: probeUi('dashboard.tsx#Dashboard') } },
      layouts: { dashboard: probeUi('admin-shell.tsx#AdminShell'), record: probeUi('record-page.tsx#RecordPage') },
      components: { money: probeUi('money.tsx#Money') },
    }),
    service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'drizzle', schema: 'zod', authorize: defaultAuthorize }),
  },
})
withComponents.defineKayan({
  name: 'componentProbe',
  fields: { price: { kind: 'number', label: { ar: 'السعر', en: 'Price' }, targets: { dashboard: { component: 'money' } } } },
  targets: { service: { operations: defaultOperations } },
})
withComponents.defineKayan({
  name: 'strayComponentProbe',
  // @ts-expect-error "currency" is not one of this screen's components
  fields: { price: { kind: 'number', label: { ar: 'السعر', en: 'Price' }, targets: { dashboard: { component: 'currency' } } } },
  targets: { service: { operations: defaultOperations } },
})
withComponents.defineGlobal({
  name: 'strayComponentGlobalProbe',
  // @ts-expect-error a global's fields are checked the same way a kayan's are
  fields: { price: { kind: 'number', label: { ar: 'السعر', en: 'Price' }, targets: { dashboard: { component: 'currency' } } }, ...defaultGlobalFields },
  targets: { service: { operations: defaultGlobalOperations } },
})
withComponents.defineKayan({
  name: 'cellTypeProbe',
  fields: { price: { kind: 'text', targets: { dashboard: { cell: 'number' } } }, fee: { kind: 'number', targets: { dashboard: { cell: 'money' } } } },
  targets: { service: { operations: defaultOperations } },
})
withComponents.defineKayan({
  name: 'strayCellProbe',
  // @ts-expect-error "monye" is neither a component of this screen nor one the registry ships
  fields: { price: { kind: 'number', targets: { dashboard: { cell: 'monye' } } } },
  targets: { service: { operations: defaultOperations } },
})
withComponents.defineKayan({
  name: 'unbroughtControlProbe',
  // @ts-expect-error no kind of this language names the "richText" control
  fields: { body: { kind: 'text', targets: { dashboard: { component: 'richText' } } } },
  targets: { service: { operations: defaultOperations } },
})
const withRichText = defineMithaq({
  locales: ['ar', 'en'] as const,
  arkan: [base, richText({ nodes: richTextNodes })],
  targets: withComponents.targets,
})
withRichText.defineKayan({
  name: 'broughtControlProbe',
  fields: { body: { kind: 'richText', targets: { dashboard: { component: 'richText', cell: 'richText' } } } },
  targets: { service: { operations: defaultOperations } },
})
const withOwnPicker = defineMithaq({
  locales: ['ar', 'en'] as const,
  arkan: [base, defineRukn({
    name: 'slugs',
    kinds: {
      slug: kind<string>((value): value is string => typeof value === 'string')({
        label: { ar: 'معرف', en: 'Slug' },
        message: { ar: 'ليس معرفا.', en: 'Not a slug.' },
        rules: ['required'],
        targets: { drizzle: drizzleKinds.text, zod: () => z.string(), screen: { control: 'slugPicker', cell: 'text' } },
      }),
    },
  })],
  targets: withComponents.targets,
})
withOwnPicker.defineKayan({
  name: 'unshippedControlProbe',
  // @ts-expect-error "slugPicker" is no control the registry ships and no component of this screen
  fields: { slug: { kind: 'slug', targets: { dashboard: { component: 'slugPicker' } } } },
  targets: { service: { operations: defaultOperations } },
})
withComponents.defineKayan({
  name: 'descriptionProbe',
  fields: {
    price: { kind: 'number', label: { ar: 'السعر', en: 'Price' }, description: { ar: 'بالريال', en: 'In riyals' } },
  },
  targets: { service: { operations: defaultOperations } },
})
withComponents.defineKayan({
  name: 'shortDescriptionProbe',
  // @ts-expect-error a description that omits the declared "ar" locale is refused where it is written
  fields: { price: { kind: 'number', label: { ar: 'السعر', en: 'Price' }, description: { en: 'In riyals' } } },
  targets: { service: { operations: defaultOperations } },
})
// A locale the language never declared is refused on a description too, by its own member of the
// same stray-key intersection. `FieldOf<L>` narrowing the description is not enough on its own, and
// nor is excess-property checking: `Fields` is inferred from this declaration, so the target type
// already holds `fr` and there is no excess property to report.
withComponents.defineKayan({
  name: 'strayDescriptionLocaleProbe',
  // @ts-expect-error "fr" is not one of this language's locales
  fields: { price: { kind: 'number', label: { ar: 'السعر', en: 'Price' }, description: { ar: 'بالريال', en: 'In riyals', fr: 'En riyals' } } },
  targets: { service: { operations: defaultOperations } },
})
withComponents.defineKayan({
  name: 'buttonLabelProbe',
  fields: { price: { kind: 'number', label: { ar: 'السعر', en: 'Price' } } },
  targets: {
    service: { operations: defaultOperations },
    dashboard: { pages: { edit: { path: '/probes/:id', page: { shell: 'dashboard', main: [{ layout: 'record', main: [{ form: ['price'] }], danger: [{ button: 'touch', label: { ar: 'أرشفة', en: 'Archive' } }] }] } } } },
  },
})
withComponents.defineKayan({
  name: 'shortButtonLabelProbe',
  fields: { price: { kind: 'number', label: { ar: 'السعر', en: 'Price' } } },
  targets: {
    service: { operations: defaultOperations },
    // @ts-expect-error a button label that omits the declared "ar" locale is refused where it is written
    dashboard: { pages: { edit: { path: '/probes/:id', page: { shell: 'dashboard', main: [{ layout: 'record', main: [{ form: ['price'] }], danger: [{ button: 'touch', label: { en: 'Archive' } }] }] } } } },
  },
})
withComponents.defineKayan({
  name: 'strayButtonLocaleProbe',
  fields: { price: { kind: 'number', label: { ar: 'السعر', en: 'Price' } } },
  targets: {
    service: { operations: defaultOperations },
    // @ts-expect-error "fr" is not one of this language's locales
    dashboard: { pages: { edit: { path: '/probes/:id', page: { shell: 'dashboard', main: [{ layout: 'record', main: [{ form: ['price'] }], danger: [{ button: 'touch', label: { ar: 'أرشفة', en: 'Archive', fr: 'Archiver' } }] }] } } } },
  },
})
withComponents.defineKayan({
  name: 'buttonPositionProbe',
  fields: { price: { kind: 'number', label: { ar: 'السعر', en: 'Price' } } },
  targets: {
    service: { operations: defaultOperations },
    dashboard: { pages: { edit: { path: '/probes/:id', page: { shell: 'dashboard', main: [{ layout: 'record', main: [{ form: ['price'] }], danger: [{ button: 'touch', label: { ar: 'أرشفة', en: 'Archive' }, confirm: { title: { ar: 'أرشفة', en: 'Archive' }, body: { ar: 'متأكد؟', en: 'Sure?' } } }] }] } } } },
  },
})
withComponents.defineKayan({
  name: 'strayButtonPositionProbe',
  fields: { price: { kind: 'number', label: { ar: 'السعر', en: 'Price' } } },
  targets: {
    service: { operations: defaultOperations },
    // @ts-expect-error a confirm body that omits the declared "ar" locale is refused where it is written
    dashboard: { pages: { edit: { path: '/probes/:id', page: { shell: 'dashboard', main: [{ layout: 'record', main: [{ form: ['price'] }], danger: [{ button: 'touch', label: { ar: 'أرشفة', en: 'Archive' }, confirm: { title: { ar: 'أرشفة', en: 'Archive' }, body: { en: 'Sure?' } } }] }] } } } },
  },
})
withComponents.defineKayan({
  name: 'buttonFieldProbe',
  fields: { price: { kind: 'number', label: { ar: 'السعر', en: 'Price' } } },
  targets: {
    service: {
      operations: {
        ...defaultOperations,
        touch: {
          targets: { dashboard: { fields: { reason: { kind: 'text', label: { ar: 'السبب', en: 'Reason' }, rules: { maxLength: 200 } } } } },
          steps: ({ steps }) => [steps.update],
        },
      },
    },
  },
})
withComponents.defineKayan({
  name: 'buttonFieldKindProbe',
  fields: { price: { kind: 'number', label: { ar: 'السعر', en: 'Price' } } },
  targets: {
    service: {
      operations: {
        ...defaultOperations,
        touch: {
          targets: { dashboard: {
            // @ts-expect-error "paragraph" is not a kind of this language
            fields: { reason: { kind: 'paragraph', label: { ar: 'السبب', en: 'Reason' } } },
          } },
          steps: ({ steps }) => [steps.update],
        },
      },
    },
  },
})
withComponents.defineKayan({
  name: 'shortButtonFieldLabelProbe',
  fields: { price: { kind: 'number', label: { ar: 'السعر', en: 'Price' } } },
  targets: {
    service: {
      operations: {
        ...defaultOperations,
        touch: {
          targets: { dashboard: {
            // @ts-expect-error an input field's label that omits the declared "ar" locale is refused where it is written
            fields: { reason: { kind: 'text', label: { en: 'Reason' } } },
          } },
          steps: ({ steps }) => [steps.update],
        },
      },
    },
  },
})

withComponents.defineKayan({
  name: 'placeholderProbe',
  fields: {
    price: { kind: 'number', label: { ar: 'السعر', en: 'Price' }, placeholder: { ar: '٠٫٠٠', en: '0.00' } },
  },
  targets: { service: { operations: defaultOperations } },
})
withComponents.defineKayan({
  name: 'shortPlaceholderProbe',
  // @ts-expect-error a placeholder that omits the declared "ar" locale is refused where it is written
  fields: { price: { kind: 'number', label: { ar: 'السعر', en: 'Price' }, placeholder: { en: '0.00' } } },
  targets: { service: { operations: defaultOperations } },
})
withComponents.defineKayan({
  name: 'strayPlaceholderLocaleProbe',
  // @ts-expect-error "fr" is not one of this language's locales
  fields: { price: { kind: 'number', label: { ar: 'السعر', en: 'Price' }, placeholder: { ar: '٠٫٠٠', en: '0.00', fr: '0,00' } } },
  targets: { service: { operations: defaultOperations } },
})
withComponents.defineGlobal({
  name: 'strayPlaceholderGlobalProbe',
  // @ts-expect-error a global's fields are checked the same way a kayan's are
  fields: { price: { kind: 'number', label: { ar: 'السعر', en: 'Price' }, placeholder: { ar: '٠٫٠٠', en: '0.00', fr: '0,00' } }, ...defaultGlobalFields },
  targets: { service: { operations: defaultGlobalOperations } },
})
// The screen's block is an annotated position rather than an inferred one, so object-literal
// freshness reports both a locale the language never declared and one the declaration left out.
withComponents.defineKayan({
  name: 'kayanDescriptionProbe',
  targets: { dashboard: { description: { ar: 'عن الدورات', en: 'About courses' } }, service: { operations: defaultOperations } },
  fields: { price: { kind: 'number', label: { ar: 'السعر', en: 'Price' } } },
})
withComponents.defineKayan({
  name: 'shortKayanDescriptionProbe',
  // @ts-expect-error a kayan description that omits the declared "ar" locale is refused where it is written
  targets: { dashboard: { description: { en: 'About courses' } }, service: { operations: defaultOperations } },
  fields: { price: { kind: 'number', label: { ar: 'السعر', en: 'Price' } } },
})
withComponents.defineKayan({
  name: 'strayKayanDescriptionLocaleProbe',
  // @ts-expect-error "fr" is not one of this language's locales
  targets: { dashboard: { description: { ar: 'عن الدورات', en: 'About courses', fr: 'Sur les cours' } }, service: { operations: defaultOperations } },
  fields: { price: { kind: 'number', label: { ar: 'السعر', en: 'Price' } } },
})
const groupPage = <const Node>(node: Node) => ({ edit: { path: '/probes/:id', page: { shell: 'dashboard', main: [{ form: [node] }] } } }) as const
withComponents.defineKayan({
  name: 'groupLabelProbe',
  targets: {
    dashboard: {
      pages: {
        edit: {
          path: '/probes/:id',
          page: { shell: 'dashboard', main: [{
            layout: 'record',
            main: [{
              form: [{
                section: 'about',
                label: { ar: 'عن', en: 'About' },
                description: { ar: 'وصف', en: 'A description' },
                fields: [{ tabs: [{ tab: 'pricing', label: { ar: 'السعر', en: 'Pricing' }, fields: ['price'] }] }],
              }],
            }],
          }] },
        },
      },
    },
    service: { operations: defaultOperations },
  },
  fields: { price: { kind: 'number', label: { ar: 'السعر', en: 'Price' } } },
})
withComponents.defineKayan({
  name: 'shortSectionLabelProbe',
  // @ts-expect-error a section label that omits the declared "ar" locale is refused where it is written
  targets: { dashboard: { pages: groupPage({ section: 'about', label: { en: 'About' }, fields: ['price'] }) }, service: { operations: defaultOperations } },
  fields: { price: { kind: 'number', label: { ar: 'السعر', en: 'Price' } } },
})
withComponents.defineKayan({
  name: 'shortSectionDescriptionProbe',
  // @ts-expect-error a section description that omits the declared "ar" locale is refused the same way
  targets: { dashboard: { pages: groupPage({ section: 'about', label: { ar: 'عن', en: 'About' }, description: { en: 'A description' }, fields: ['price'] }) }, service: { operations: defaultOperations } },
  fields: { price: { kind: 'number', label: { ar: 'السعر', en: 'Price' } } },
})
// A tab is narrowed by the same group type a section is, so the two refusals are structural rather
// than written twice, which is exactly why the tab needs its own probe: nothing else pins that the
// shared type is reached through the `tabs` arm.
withComponents.defineKayan({
  name: 'shortTabLabelProbe',
  // @ts-expect-error a tab label that omits the declared "ar" locale is refused where it is written
  targets: { dashboard: { pages: groupPage({ tabs: [{ tab: 'general', label: { en: 'General' }, fields: ['price'] }] }) }, service: { operations: defaultOperations } },
  fields: { price: { kind: 'number', label: { ar: 'السعر', en: 'Price' } } },
})
withComponents.defineKayan({
  name: 'shortTabDescriptionProbe',
  // @ts-expect-error a tab description that omits the declared "ar" locale is refused the same way
  targets: { dashboard: { pages: groupPage({ tabs: [{ tab: 'general', label: { ar: 'عام', en: 'General' }, description: { en: 'What it holds' }, fields: ['price'] }] }) }, service: { operations: defaultOperations } },
  fields: { price: { kind: 'number', label: { ar: 'السعر', en: 'Price' } } },
})
withComponents.defineKayan({
  name: 'unnamedSectionProbe',
  // @ts-expect-error a section with no name is no node a page draws
  targets: { dashboard: { pages: groupPage({ label: { ar: 'عن', en: 'About' }, fields: ['price'] }) }, service: { operations: defaultOperations } },
  fields: { price: { kind: 'number', label: { ar: 'السعر', en: 'Price' } } },
})
withComponents.defineKayan({
  name: 'unnamedTabProbe',
  // @ts-expect-error a tab with no name is refused too, and `tab` is the word a section spells `section`
  targets: { dashboard: { pages: groupPage({ tabs: [{ label: { ar: 'عام', en: 'General' }, fields: ['price'] }] }) }, service: { operations: defaultOperations } },
  fields: { price: { kind: 'number', label: { ar: 'السعر', en: 'Price' } } },
})
withComponents.defineKayan({
  name: 'unlabelledSectionProbe',
  // @ts-expect-error a group with no label is a `row`, so the label is required where the name is
  targets: { dashboard: { pages: groupPage({ section: 'about', fields: ['price'] }) }, service: { operations: defaultOperations } },
  fields: { price: { kind: 'number', label: { ar: 'السعر', en: 'Price' } } },
})
withComponents.defineKayan({
  name: 'rowProbe',
  targets: { dashboard: { pages: groupPage({ row: ['price'] }) }, service: { operations: defaultOperations } },
  fields: { price: { kind: 'number', label: { ar: 'السعر', en: 'Price' } } },
})
withComponents.defineKayan({
  name: 'oldGroupKeyProbe',
  // @ts-expect-error groups use fields, not of
  targets: { dashboard: { pages: groupPage({ section: 'about', label: { ar: 'عن', en: 'About' }, of: ['price'] }) }, service: { operations: defaultOperations } },
  fields: { price: { kind: 'number', label: { ar: 'السعر', en: 'Price' } } },
})
// `useAsTitle` is checked at `buildAsas` as well, because a kayan written as plain data never
// passes through here.
withComponents.defineKayan({
  name: 'unknownTitleProbe',
  // @ts-expect-error useAsTitle must name a field of this kayan
  targets: { dashboard: { useAsTitle: 'nope' }, service: { operations: defaultOperations } },
  fields: { price: { kind: 'number', label: { ar: 'السعر', en: 'Price' } } },
})

// Each is narrowed to one value, because each is a switch away from its default and the other value
// says nothing: `filter` and `searchable` are opt-ins, so only `true` means anything, and
// `sortable` is a deny, so only `false` does.
withComponents.defineKayan({
  name: 'listControlKeysProbe',
  fields: {
    price: {
      kind: 'number',
      label: { ar: 'السعر', en: 'Price' },
      targets: { dashboard: { filter: true, sortable: false } },
    },
    note: { kind: 'text', label: { ar: 'ملاحظة', en: 'Note' }, targets: { dashboard: { searchable: true } } },
  },
  targets: { service: { operations: defaultOperations } },
})
withComponents.defineKayan({
  name: 'filterFalseProbe',
  // @ts-expect-error a field is filterable only when it says so, so `false` is not a value
  fields: { price: { kind: 'number', label: { ar: 'السعر', en: 'Price' }, targets: { dashboard: { filter: false } } } },
  targets: { service: { operations: defaultOperations } },
})
withComponents.defineKayan({
  name: 'searchableFalseProbe',
  // @ts-expect-error a field is searched only when it says so, so `false` is not a value
  fields: { price: { kind: 'text', label: { ar: 'السعر', en: 'Price' }, targets: { dashboard: { searchable: false } } } },
  targets: { service: { operations: defaultOperations } },
})
withComponents.defineKayan({
  name: 'sortableTrueProbe',
  // @ts-expect-error a field is sortable unless it says otherwise, so `true` is not a value
  fields: { price: { kind: 'text', label: { ar: 'السعر', en: 'Price' }, targets: { dashboard: { sortable: true } } } },
  targets: { service: { operations: defaultOperations } },
})

const screenOver = <const Controls extends Record<string, { cell: string; control: string }>>(controls: Controls) =>
  screenTarget({ path: '/dashboard', kayan: [], controls, providers: [], pages: { home: { path: '/', component: probeUi('a.tsx#A') } }, layouts: {}, components: {} })
const { date: _drawnDate, ...controlsWithoutDate } = screenKinds
defineMithaq({
  arkan: [base],
  targets: {
    ...localeTargets,
    // @ts-expect-error the screen draws no "date", and every kind of the language has a control and a cell
    dashboard: screenOver(controlsWithoutDate),
    service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'drizzle', schema: 'zod', authorize: defaultAuthorize }),
  },
})
defineMithaq({
  arkan: [base],
  targets: {
    ...localeTargets,
    // @ts-expect-error "paragraph" is no kind of this language
    dashboard: screenOver({ ...screenKinds, paragraph: { cell: 'text', control: 'text' } }),
    service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'drizzle', schema: 'zod', authorize: defaultAuthorize }),
  },
})

// The service target owns these keys, and one left on the language root is a second spelling of one
// fact, refused where it is written.
const serviceProbeTargets = {
  drizzle: drizzleAdapter({ connectionString: 'postgresql://never-connected', kinds: drizzleKinds, rules: drizzleRules, push: false }),
  zod: zodTarget,
}
defineMithaq({
  arkan: [base],
  targets: { ...serviceProbeTargets, service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'drizzle', schema: 'zod', authorize: defaultAuthorize }) },
  // @ts-expect-error `operations` is the service target's, and the language root does not take it
  operations: defaultOperations,
})
defineMithaq({
  arkan: [base],
  targets: { ...serviceProbeTargets, service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'drizzle', schema: 'zod', authorize: defaultAuthorize }) },
  // @ts-expect-error `audit` belongs to the service target
  audit: () => {},
})
defineMithaq({
  arkan: [base],
  targets: { ...serviceProbeTargets, service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'drizzle', schema: 'zod', authorize: defaultAuthorize }) },
  // @ts-expect-error `depth` belongs to the service target
  depth: 4,
})
// The audit slot takes a sink typed for the project's own actor, and the language holds it to every
// actor the runner hands it: the one its access target's `rolesOf` takes, and `mithaq rbac
// assign`'s own `CommandActor`.
const auditRoles = (user: OrganizationActor) => (user.activeOrganizationId ? ['administrator'] : [])
const auditRunner = <Audit extends AuditHandler<never>>(audit: Audit) =>
  serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'drizzle', schema: 'zod', authorize: defaultAuthorize, audit })
const bothActors: AuditHandler<OrganizationActor | CommandActor> = async ({ user }) =>
  void (user && ('osUser' in user ? user.osUser : user.activeOrganizationId))
defineMithaq({
  arkan: [base],
  targets: { ...serviceProbeTargets, rbac: rbacTarget({ roles: systemRoles, rolesOf: auditRoles, kayan: { roles: 'roles', memberRoles: 'memberRoles' } }), service: auditRunner(bothActors) },
})
// A sink typed for the request's actor alone is refused, since the command hands it `{ command,
// osUser }`, and so is one typed for another actor.
const requestOnly: AuditHandler<OrganizationActor> = async (entry) => void entry.user?.activeOrganizationId
const emailOnly: AuditHandler<{ email: string } | CommandActor> = async (entry) => void entry.user
defineMithaq({
  arkan: [base],
  targets: {
    ...serviceProbeTargets,
    rbac: rbacTarget({ roles: systemRoles, rolesOf: auditRoles, kayan: { roles: 'roles', memberRoles: 'memberRoles' } }),
    // @ts-expect-error the sink does not take the command's actor
    service: auditRunner(requestOnly),
  },
})
defineMithaq({
  arkan: [base],
  targets: {
    ...serviceProbeTargets,
    rbac: rbacTarget({ roles: systemRoles, rolesOf: auditRoles, kayan: { roles: 'roles', memberRoles: 'memberRoles' } }),
    // @ts-expect-error the sink does not take the actor `rolesOf` takes
    service: auditRunner(emailOnly),
  },
})
defineMithaq({
  arkan: [base],
  // @ts-expect-error no access target names `OrganizationActor`
  targets: { ...serviceProbeTargets, service: auditRunner(bothActors) },
})
defineMithaq({ arkan: [base], targets: { ...serviceProbeTargets, service: auditRunner((async () => {}) as AuditHandler<unknown>) } })
defineMithaq({
  arkan: [base],
  targets: {
    ...serviceProbeTargets,
    // @ts-expect-error transport is its own category, so a runner carrying `http` is refused
    service: { ...serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'drizzle', schema: 'zod', authorize: defaultAuthorize }), http: [] },
  },
})
// @ts-expect-error `operations` is no key of the service target
defineMithaq({
  arkan: [base],
  targets: {
    ...serviceProbeTargets,
    service: {
      capability: 'service',
      store: 'drizzle',
      schema: 'zod',
      authorize: defaultAuthorize,
      depth: defaultDepth,
      defaultLimit,
      maxLimit: defaultMaxLimit,
      joinLimit: defaultJoinLimit,
      bulkLimit: defaultBulkLimit,
      operations: { create: defaultOperations.create },
    },
  },
})
const narrowRunner = defineMithaq({
  arkan: [base],
  targets: {
    ...serviceProbeTargets,
    service: {
      capability: 'service',
      store: 'drizzle',
      schema: 'zod',
      authorize: defaultAuthorize,
      depth: defaultDepth,
      defaultLimit,
      maxLimit: defaultMaxLimit,
      joinLimit: defaultJoinLimit,
      bulkLimit: defaultBulkLimit,
    },
  },
})
narrowRunner.defineKayan({
  name: 'serviceShapeProbe',
  fields: { id: defaultFields.id },
  targets: {
    service: {
      operations: { ...defaultOperations, archive: { steps: ({ operations }) => operations.create } },
    },
  },
})
narrowRunner.defineKayan({
  name: 'serviceShapeUpdateProbe',
  fields: { id: defaultFields.id },
  targets: {
    service: {
      // @ts-expect-error the shipped record has no `archive` list, so a steps function has none to hand back
      operations: { ...defaultOperations, archive: { steps: ({ operations }) => operations.archive } },
    },
  },
})
narrowRunner.defineKayan({
  name: 'serviceShapeKeyProbe',
  fields: { id: defaultFields.id },
  targets: {
    service: {
      // @ts-expect-error `bogus` is no key of an operation declaration
      operations: { ...defaultOperations, archive: { steps: ({ operations }) => operations.create, bogus: 1 } },
    },
  },
})
const noRunner = defineMithaq({ arkan: [base], targets: serviceProbeTargets })
noRunner.defineKayan({
  name: 'noServiceProbe',
  fields: { id: defaultFields.id },
  targets: {
    service: {
      // @ts-expect-error this build declares no service target, so a kayan has no operation to declare
      operations: { ...defaultOperations, archive: { steps: [] } },
    },
  },
})

// `ctx.context` is the project's own shape, declared once on the runner and read by every step of
// the project. The key is a type and nothing else, so it is written as an assertion, the way the
// zod target puts its own type-only member on.
type ProjectContext = { requestId: string }
type ProjectCtx<Data extends Record<string, unknown> = Record<string, unknown>> =
  Ctx<Data, unknown, unknown, ProjectContext>
const readsTheDeclaredContextKey = (ctx: ProjectCtx): ProjectCtx => {
  const requestId: string = ctx.context.requestId
  const depth: number = ctx.context.depth
  return { ...ctx, data: { ...ctx.data, requestId, depth } }
}
const readsAContextKeyNobodyDeclared = (ctx: ProjectCtx): ProjectCtx => {
  // @ts-expect-error `traceId` is no key of this project's context
  void ctx.context.traceId
  return ctx
}
void readsAContextKeyNobodyDeclared
// `ctx.tenant` is the operation's active organization, or nothing, and a step does not assign it.
const readsTheTenant: WriteStep = (ctx) => {
  const tenant: string | undefined = ctx.tenant
  // @ts-expect-error `ctx.tenant` may be absent, on a shared kayan or a read past one organization
  const always: string = ctx.tenant
  // @ts-expect-error `ctx.tenant` is read-only
  ctx.tenant = 'another'
  void always
  return { ...ctx, data: { ...ctx.data, tenant } }
}
void readsTheTenant
// A step of another project, to show the runner's own lists grade the context.
const readsAnotherProjectsContext = (ctx: Ctx<Record<string, unknown>, unknown, unknown, { tenantId: string }>): Ctx => ({
  ...ctx,
  data: { ...ctx.data, tenantId: ctx.context.tenantId },
})
// The runner's own three lists are typed off the context the same target declared, which an object
// type cannot do for a sibling key and the factory can, because it sees the whole argument at once.
const contextRunner = serviceTarget({
  depth: defaultDepth,
  defaultLimit,
  maxLimit: defaultMaxLimit,
  joinLimit: defaultJoinLimit,
  bulkLimit: defaultBulkLimit,
  store: 'drizzle',
  schema: 'zod',
  authorize: defaultAuthorize,
  context: {} as ProjectContext,
  beforeSteps: [readsTheDeclaredContextKey],
  afterSteps: [readsTheDeclaredContextKey],
  afterCommit: [readsTheDeclaredContextKey],
})
serviceTarget({
  depth: defaultDepth,
  defaultLimit,
  maxLimit: defaultMaxLimit,
  joinLimit: defaultJoinLimit,
  bulkLimit: defaultBulkLimit,
  store: 'drizzle',
  schema: 'zod',
  authorize: defaultAuthorize,
  context: {} as ProjectContext,
  // @ts-expect-error this runner declared `requestId`, so a step reading another project's context is no step of it
  beforeSteps: [readsAnotherProjectsContext],
})
const contextLanguage = defineMithaq({
  arkan: [base],
  targets: { ...serviceProbeTargets, service: contextRunner },
})
type RunnerCtx = CtxOf<typeof contextRunner>
type RunnerContextIsTheDeclaredOne = Expect<Equal<RunnerCtx['context']['requestId'], string>>
// A step typed with the project's context is taken in all four lists an operation may write, and
// not in `steps` alone: a step of `beforeTransaction`, `afterSteps` or `afterCommit` is a step of
// this project too, and an index signature satisfies no required key, so a slot left at the open
// record would refuse the alias.
const contextProbeKayan = contextLanguage.defineKayan({
  name: 'projectContextProbe',
  access: { create: () => true, read: () => true, update: () => true, delete: () => true },
  fields: { ...defaultFields, title: { kind: 'text', label: { ar: 'العنوان', en: 'Title' }, rules: { required: true } } },
  targets: {
    service: {
      operations: {
        ...defaultOperations,
        create: {
          steps: ({ steps }) => [readsTheDeclaredContextKey, steps.insert],
          beforeTransaction: [readsTheDeclaredContextKey],
          afterSteps: [readsTheDeclaredContextKey],
          afterCommit: [readsTheDeclaredContextKey],
        },
      },
    },
  },
})
type StepContextDepth = Expect<Equal<Parameters<Step>[0]['context']['depth'], number>>
type StepContextSource = Expect<Equal<Parameters<Step>[0]['context']['source'], string>>
// A project that declares no context reads every key of it as `unknown`. The subject is a runner
// that declared none, not a targets record with no runner in it at all.
const contextlessRunner = serviceTarget({
  depth: defaultDepth,
  defaultLimit,
  maxLimit: defaultMaxLimit,
  joinLimit: defaultJoinLimit,
  bulkLimit: defaultBulkLimit,
  store: 'drizzle',
  schema: 'zod',
  authorize: defaultAuthorize,
})
type OpenContextKey = Expect<Equal<CtxOf<typeof contextlessRunner>['context']['whatever'], unknown>>

// The keys a step reads typed are the keys its caller has to have sent, so a build whose runner
// declared a context takes one on every call that opens a write or a read.
const contextBuilt = contextLanguage.buildAsas({ http: [fetchHttp()], kayan: [contextProbeKayan] })
contextBuilt.kayan.projectContextProbe.operations.create({ title: 'A' }, { context: { requestId: 'r-1' } })
// @ts-expect-error this build's runner declared a context, so a caller sends one
contextBuilt.kayan.projectContextProbe.operations.create({ title: 'A' })
// @ts-expect-error `requestId` is the key the runner declared, and this context is short of it
contextBuilt.kayan.projectContextProbe.operations.create({ title: 'A' }, { context: {} })
// @ts-expect-error `traceId` is no key of this project's context
contextBuilt.kayan.projectContextProbe.operations.create({ title: 'A' }, { context: { requestId: 'r-1', traceId: 't' } })
contextBuilt.kayan.projectContextProbe.operations.findByID({ id: 'x' }, { context: { requestId: 'r-1' } })
// @ts-expect-error a read takes the context the runner declared, as a write does
contextBuilt.kayan.projectContextProbe.operations.findByID({ id: 'x' })
contextBuilt.kayan.projectContextProbe.operations.count({}, { context: { requestId: 'r-1' } })
// @ts-expect-error a count takes the context the runner declared, as every operation does
contextBuilt.kayan.projectContextProbe.operations.count({})
// @ts-expect-error the options are the second argument, never a key of the input
contextBuilt.kayan.projectContextProbe.operations.count({ context: { requestId: 'r-1' } })
// @ts-expect-error nor of a find's input
contextBuilt.kayan.projectContextProbe.operations.find({ context: { requestId: 'r-1' } }, { context: { requestId: 'r-1' } })
asas.kayan.tags.operations.count()

type TagOptions = Parameters<typeof asas.kayan.tags.operations.create>[1]
// A read takes a write's options and its reach past the active organization; a write takes no reach.
type TagReadOptions = NonNullable<TagOptions> & { tenant?: 'mine' | 'all' }
type FindSignature = Expect<Equal<
  Parameters<typeof asas.kayan.tags.operations.find>,
  [input?: { depth?: number; limit?: number; page?: number; sort?: string; where?: Where }, options?: TagReadOptions]
>>
type CountSignature = Expect<Equal<Parameters<typeof asas.kayan.tags.operations.count>, [input?: { where?: Where }, options?: TagReadOptions]>>
type CustomSignature = Expect<Equal<
  Parameters<typeof overrideBuilt.kayan.typedOverride.operations.findTagged>,
  [input: { tag: string }, options?: NonNullable<Parameters<typeof overrideBuilt.kayan.typedOverride.operations.create>[1]> & { tenant?: 'mine' | 'all' }]
>>
asas.kayan.tags.operations.find({}, { tenant: 'mine' })
// @ts-expect-error a reach is "mine" or "all"
asas.kayan.tags.operations.find({}, { tenant: 'every' })
// @ts-expect-error a write lands in the active organization alone, so it takes no reach
asas.kayan.tags.operations.create({ name: 'x' } as never, { tenant: 'mine' })
const findInserts = customLanguage.defineKayan({
  name: 'findInserts',
  fields: { id: { kind: 'number' }, title: { kind: 'text', rules: { required: true } } },
  targets: { service: { operations: { ...defaultOperations, find: { steps: ({ steps }) => [steps.insert] } } } },
})
const findInsertsBuilt = customLanguage.buildAsas({ http: [fetchHttp()], kayan: [findInserts] })
findInsertsBuilt.kayan.findInserts.operations.find({ title: 'A' }, { actor: null })
// @ts-expect-error the create shape requires the title
findInsertsBuilt.kayan.findInserts.operations.find({}, { actor: null })
type FindInsertsResult = Expect<Equal<Awaited<ReturnType<typeof findInsertsBuilt.kayan.findInserts.operations.find>>['title'], string>>

// Each of the three shapes is pinned by a required key only that shape has: the create shape
// requires the kayan's required column and leaves the id optional, the update shape requires the id
// and leaves every column optional, and a declared `input` requires whatever it says.
const probeArchiveInput = z.object({ id: z.guid(), reason: z.string() })
const readsTheDeclaredInput = (ctx: Ctx<z.infer<typeof probeArchiveInput>>): Ctx => ({
  ...ctx,
  data: { ...ctx.data, archiveReason: ctx.data.reason },
})
const readsTheCreateShape = (ctx: Ctx<{ title: string }>): Ctx => ({ ...ctx, data: { ...ctx.data } })
const readsTheUpdateShape = (ctx: Ctx<{ id: string }>): Ctx => ({ ...ctx, data: { ...ctx.data } })
const probeDataFields = {
  ...defaultFields,
  title: { kind: 'text', label: { ar: 'العنوان', en: 'Title' }, rules: { required: true } },
} as const
defineKayan({
  name: 'operationDataProbe',
  fields: probeDataFields,
  targets: {
    service: {
      operations: {
        ...defaultOperations,
        create: { steps: ({ steps }) => [steps.insert, readsTheCreateShape] },
        archive: { input: () => probeArchiveInput, steps: ({ steps }) => [readsTheDeclaredInput, steps.update] },
        touch: { steps: ({ steps }) => [readsTheUpdateShape, steps.update] },
      },
    },
  },
})
defineKayan({
  name: 'operationDataCreateStrayProbe',
  fields: probeDataFields,
  targets: {
    service: {
      operations: {
        ...defaultOperations,
        // @ts-expect-error a create list leaves the id to the store, so a step cannot ask for it
        create: { steps: ({ steps }) => [steps.insert, readsTheUpdateShape] },
      },
    },
  },
})
defineKayan({
  name: 'operationDataUpdateStrayProbe',
  fields: probeDataFields,
  targets: {
    service: {
      operations: {
        ...defaultOperations,
        // @ts-expect-error an update list carries only what changes, so a step cannot ask for a column
        touch: { steps: ({ steps }) => [readsTheCreateShape, steps.update] },
      },
    },
  },
})
defineKayan({
  name: 'operationDataInputStrayProbe',
  fields: probeDataFields,
  targets: {
    service: {
      operations: {
        ...defaultOperations,
        // @ts-expect-error this operation parses an id and a reason, and no `title`
        archive: { input: () => probeArchiveInput, steps: ({ steps }) => [readsTheCreateShape, steps.update] },
      },
    },
  },
})
// The three slots beside `steps` type no operation's own shape. `readsTheUpdateShape` is taken in
// `steps` of `touch` above, where the parse has just run, and refused in each slot, where the store
// step may already have rewritten `ctx.data`: the row a delete removed, a `BulkResult`, or what a
// managed read read.
defineKayan({
  name: 'operationDataBeforeTransactionProbe',
  fields: probeDataFields,
  targets: {
    service: {
      operations: {
        ...defaultOperations,
        // @ts-expect-error `beforeTransaction` runs before the runner parses anything, so its data is the caller's own values as they were sent
        touch: { steps: ({ steps }) => [steps.update], beforeTransaction: [readsTheUpdateShape] },
      },
    },
  },
})
defineKayan({
  name: 'operationDataAfterStepsProbe',
  fields: probeDataFields,
  targets: {
    service: {
      operations: {
        ...defaultOperations,
        // @ts-expect-error `afterSteps` runs after the store step, so its data is what that step left, which is no longer what the operation parsed wherever it replaced it
        touch: { steps: ({ steps }) => [steps.update], afterSteps: [readsTheUpdateShape] },
      },
    },
  },
})
defineKayan({
  name: 'operationDataAfterCommitProbe',
  fields: probeDataFields,
  targets: {
    service: {
      operations: {
        ...defaultOperations,
        // @ts-expect-error `afterCommit` is handed what the transaction ended with, which is no longer what the operation parsed wherever the store step replaced it
        touch: { steps: ({ steps }) => [steps.update], afterCommit: [readsTheUpdateShape] },
      },
    },
  },
})
const readsTheOpenRecord = (ctx: Ctx): Ctx => ({ ...ctx, data: { ...ctx.data } })
defineKayan({
  name: 'operationDataOpenProbe',
  fields: probeDataFields,
  targets: {
    service: {
      operations: {
        ...defaultOperations,
        create: { steps: ({ steps }) => [steps.insert, readsTheOpenRecord] },
        archive: { input: () => probeArchiveInput, steps: ({ steps }) => [readsTheOpenRecord, steps.update] },
      },
    },
  },
})

const withScreen = defineMithaq({
  locales: ['ar', 'en'] as const,
  arkan: [base],
  targets: {
    ...localeTargets,
    service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'drizzle', schema: 'zod', authorize: defaultAuthorize }),
    portal: screenTarget({ path: '/portal', kayan: ['screenProbe'], controls: screenKinds, providers: [], pages: { home: { path: '/', component: probeUi('home.tsx#Home') } }, layouts: { shell: probeUi('shell.tsx#Shell'), page: probeUi('page.tsx#Page') }, components: {} }),
  },
})
withScreen.defineKayan({
  name: 'screenProbe',
  fields: { id: defaultFields.id, title: { kind: 'text', targets: { portal: { component: 'text' } } } },
  targets: {
    service: { operations: defaultOperations },
    portal: {
      pages: {
        list: { path: '/probes', page: { shell: 'shell', main: [{ layout: 'page', main: [{ list: { columns: ['title'] } }] }] } },
        // @ts-expect-error a page name twice on one kayan and screen is refused where it is written
        list: { path: '/probes/all', page: { shell: 'shell', main: [{ layout: 'page', main: [{ list: { columns: ['title'] } }] }] } },
      },
    },
  },
})
withScreen.defineKayan({
  name: 'screenLeafProbe',
  fields: { id: defaultFields.id, title: { kind: 'text' } },
  targets: {
    service: { operations: defaultOperations },
    // @ts-expect-error a leaf naming no field of this kayan is refused where it is written
    portal: { pages: { edit: { path: '/probes/:id', page: { shell: 'shell', main: [{ layout: 'page', main: [{ form: ['titel'] }] }] } } } },
  },
})
withScreen.defineKayan({
  name: 'screenRefProbe',
  fields: { id: defaultFields.id, title: { kind: 'text' } },
  targets: {
    service: { operations: defaultOperations },
    // @ts-expect-error a layout name this screen never registered is refused where it is written
    portal: { pages: { list: { path: '/probes', page: { shell: 'shell', main: [{ layout: 'tabel', main: [] }] } } } },
  },
})
withScreen.defineKayan({
  name: 'screenShellProbe',
  fields: { id: defaultFields.id, title: { kind: 'text' } },
  targets: {
    service: { operations: defaultOperations },
    // @ts-expect-error a shell name this screen never registered is refused where it is written
    portal: { pages: { list: { path: '/probes', page: { shell: 'shel', main: [] } } } },
  },
})
withScreen.defineKayan({
  name: 'screenMixedProbe',
  fields: { id: defaultFields.id, title: { kind: 'text' } },
  targets: {
    service: { operations: defaultOperations },
    // @ts-expect-error a page drawn whole by a component takes nothing else
    portal: { pages: { edit: { path: '/probes/:id', component: 'page', mode: 'dialog' } } },
  },
})
withScreen.defineKayan({
  name: 'screenBothProbe',
  fields: { id: defaultFields.id, title: { kind: 'text' } },
  targets: {
    service: { operations: defaultOperations },
    // @ts-expect-error a page is one tree or drawn whole, never both
    portal: { pages: { edit: { path: '/probes/:id', component: 'page', page: { shell: 'shell', main: [{ form: ['title'] }] } } } },
  },
})

// `mithaq screens` reads the projection and nothing else, so none of these types gains a key beside
// the ones listed.
type ScreenTargetKeys = Expect<
  Equal<keyof import('mithaq').ScreenTarget, 'capability' | 'type' | 'path' | 'kayan' | 'controls' | 'providers' | 'pages' | 'layouts' | 'components'>
>
type ScreenKayanKeys = Expect<Equal<keyof import('mithaq').ScreenKayan, 'useAsTitle' | 'description' | 'baseFilter' | 'pages'>>
type ScreenPageKeys = Expect<Equal<keyof import('mithaq').ScreenPage, 'path' | 'page' | 'mode' | 'component'>>
type ScreenOwnPageKeys = Expect<Equal<keyof import('mithaq').ScreenOwnPage, 'path' | 'component' | 'nav' | 'permission'>>
type ScreenLeafKeys = Expect<
  Equal<keyof Exclude<import('mithaq').ScreenLeaf, string>, 'field' | 'component' | 'cell' | 'placeholder' | 'description' | 'readOnly' | 'width' | 'when'>
>
type ScreenButtonKeys = Expect<Equal<keyof import('mithaq').ScreenButton, 'button' | 'label' | 'fields' | 'reload' | 'component' | 'confirm' | 'when'>>
type ScreenFieldKeys = Expect<
  Equal<keyof import('mithaq').ScreenField, 'component' | 'cell' | 'width' | 'filter' | 'searchable' | 'sortable'>
>

// The tenant target: `tenant.field` is the one ownership field, typed exactly, on a language that
// lays the target down under `tenant` alone. A field is owned by its `targets.tenant`, never its name.
{
  const ops = { service: { operations: defaultOperations } }
  const tenantLanguage = defineMithaq({ targets: { ...arkanTargets, tenant: betterAuthTenant({ relationTo: 'organization', onDelete: 'restrict', organizations: 'many' }) }, arkan: [base] })
  const noTenant = defineMithaq({ targets: arkanTargets, arkan: [base] })
  const { targets: { tenant: owner } } = tenantLanguage
  type ExactTenantField = Expect<Equal<typeof owner.field, TenantField<'organization'>>>
  // @ts-expect-error a language that lays down no tenant target has no tenant.field
  void noTenant.targets.tenant
  // @ts-expect-error betterAuthTenant takes onDelete: 'restrict' alone
  betterAuthTenant({ relationTo: 'organization', onDelete: 'cascade', organizations: 'many' })
  // @ts-expect-error the tenant target is registered under the key "tenant" alone
  defineMithaq({ targets: { ...arkanTargets, owner: betterAuthTenant({ relationTo: 'organization', onDelete: 'restrict', organizations: 'many' }) }, arkan: [base] })

  const organization = tenantLanguage.defineKayan({ name: 'organization', fields: { id: { kind: 'text' }, name: { kind: 'text' } }, targets: ops })
  const owned = tenantLanguage.defineKayan({ name: 'owned', fields: { ...defaultFields, organizationId: { ...owner.field, label: { en: 'Organization', ar: 'المؤسسة' } }, title: { kind: 'text' } }, targets: ops })
  const byHand = tenantLanguage.defineKayan({ name: 'byHand', fields: { ...defaultFields, organizationId: { kind: 'relationship', relationTo: 'organization', targets: { tenant: true } } }, targets: ops })
  tenantLanguage.defineKayan({ name: 'tenantProbe', fields: { id: defaultFields.id, organizationId: { ...owner.field, rules: { ...owner.field.rules, unique: true } } }, targets: ops })
  // @ts-expect-error a tenant field holds one row, never a set
  tenantLanguage.defineKayan({ name: 'tenantProbe', fields: { id: defaultFields.id, organizationId: { ...owner.field, hasMany: true } }, targets: ops })
  // @ts-expect-error a tenant field points at the tenant kayan and no other
  tenantLanguage.defineKayan({ name: 'tenantProbe', fields: { id: defaultFields.id, organizationId: { ...owner.field, relationTo: 'owned' } }, targets: ops })
  // @ts-expect-error the same, written by hand
  tenantLanguage.defineKayan({ name: 'tenantProbe', fields: { id: defaultFields.id, organizationId: { kind: 'relationship', relationTo: 'owned', targets: { tenant: true } } }, targets: ops })
  // @ts-expect-error the client never supplies the tenant
  tenantLanguage.defineKayan({ name: 'tenantProbe', fields: { id: defaultFields.id, organizationId: { ...owner.field, rules: { ...owner.field.rules, providedBy: { create: 'client', update: 'never' } } } }, targets: ops })
  // @ts-expect-error nor moves it on an update
  tenantLanguage.defineKayan({ name: 'tenantProbe', fields: { id: defaultFields.id, organizationId: { ...owner.field, rules: { ...owner.field.rules, providedBy: { create: 'application', update: 'client' } } } }, targets: ops })
  // @ts-expect-error a tenant restricts its delete
  tenantLanguage.defineKayan({ name: 'tenantProbe', fields: { id: defaultFields.id, organizationId: { ...owner.field, rules: { ...owner.field.rules, onDelete: 'cascade' } } }, targets: ops })
  // @ts-expect-error a tenant field is never null
  tenantLanguage.defineKayan({ name: 'tenantProbe', fields: { id: defaultFields.id, organizationId: { kind: 'relationship', relationTo: 'organization', rules: { required: false }, targets: { tenant: true } } }, targets: ops })
  // @ts-expect-error a tenant field is indexed
  tenantLanguage.defineKayan({ name: 'tenantProbe', fields: { id: defaultFields.id, organizationId: { ...owner.field, rules: { ...owner.field.rules, index: false } } }, targets: ops })
  // @ts-expect-error the tenant comes from the session, never a default
  tenantLanguage.defineKayan({ name: 'tenantProbe', fields: { id: defaultFields.id, organizationId: { ...owner.field, rules: { ...owner.field.rules, defaultValue: 'org-1' } } }, targets: ops })
  // @ts-expect-error a store's own column would replace the one the tenant's rules build
  tenantLanguage.defineKayan({ name: 'tenantProbe', fields: { id: defaultFields.id, organizationId: { ...owner.field, targets: { tenant: true, drizzle: textColumn('organization_id') } } }, targets: ops })
  // @ts-expect-error the binding is targets: { tenant: true }, and nothing opts a field out
  tenantLanguage.defineKayan({ name: 'tenantProbe', fields: { id: defaultFields.id, organizationId: { ...owner.field, targets: { tenant: false } } }, targets: ops })
  // @ts-expect-error a kayan is tenant-owned by its field, never by a key of its own
  tenantLanguage.defineKayan({ name: 'tenantProbe', fields: { id: defaultFields.id }, targets: { ...ops, tenant: false } })
  // @ts-expect-error a binding where the language lays down no tenant target
  noTenant.defineKayan({ name: 'tenantProbe', fields: { id: defaultFields.id, organizationId: { kind: 'relationship', relationTo: 'organization', targets: { tenant: true } } }, targets: ops })

  const built = tenantLanguage.buildAsas({ http: [fetchHttp()], kayan: [organization, owned, byHand] })
  type OwnedRow = NonNullable<Awaited<ReturnType<typeof built.kayan.owned.operations.findByID>>>
  type ByHandRow = NonNullable<Awaited<ReturnType<typeof built.kayan.byHand.operations.findByID>>>
  type OwnedTenantIsString = Expect<Equal<OwnedRow['organizationId'], string>>
  type ByHandTenantIsString = Expect<Equal<ByHandRow['organizationId'], string>>
  type OwnedCreateLeavesItOut = Expect<Equal<'organizationId' extends keyof NonNullable<Parameters<typeof built.kayan.owned.operations.create>[0]> ? true : false, false>>
  type ByHandCreateLeavesItOut = Expect<Equal<'organizationId' extends keyof NonNullable<Parameters<typeof built.kayan.byHand.operations.create>[0]> ? true : false, false>>
  built.kayan.owned.operations.create({ title: 'A' })
  // @ts-expect-error nor does a caller name it
  built.kayan.owned.operations.create({ title: 'A', organizationId: 'org-1' })
}
