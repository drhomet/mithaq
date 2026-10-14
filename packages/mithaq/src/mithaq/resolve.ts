import { admissions, rowsOf, rowsOfField } from './rows.ts'
import { isRef, refuseLiteral } from './user.ts'
import {
  bulkSeals,
  defaultGlobalOperations,
  holdOutput,
  readSeals,
  resolveOperations,
  sealOf,
  storeSeals,
  versionSeals,
  type LanguageSlots,
  type OperationStep,
  type OperationDeclaration,
  type OperationEffect,
  type ReadMode,
  type ResolvedOperation,
  type Seal,
} from '../asas/runner/steps.ts'
import { kayanServiceKeys, unsortable, type CompoundIndex, type Kayan, type KayanService, type RuntimeField, type LabelFunction, type Localized, type MessageMap, type MessageTree, type ResolvedKayan } from './types.ts'
import { defaultKinds } from '../base/kinds.ts'
import { compareDecimals } from '../base/decimal.ts'
import type { ScreenField } from '../screen/index.ts'
import { isAccess, isScreen, isService, isStorage, isStore, isTenant, isVersions, serviceTargetOf, tenantDefaults, type FieldTarget, type Language, type Store } from './language.ts'
import type { KayanVersions } from '../versions/index.ts'
import { versionsOf } from '../versions/versions.ts'
import { providerOf } from '../base/rules.ts'
import { implementationOf } from './rukn.ts'

// A capital opens a word, except at the start, where there is nothing to break.
export const snakeCase = (name: string) =>
  name.replace(/[A-Z]/g, (letter, at) => (at === 0 ? '' : '_') + letter.toLowerCase())

// The same string is its SQL name and its key on the store's tables, so the push
// and `mithaq migrate` reach it unchanged.
export const versionsTableOf = (kayan: { table: string }) => `_${kayan.table}_versions`

// drizzle-kit reads every table name as a minimatch glob, so only a plain
// identifier of at most 63 bytes, the length Postgres keeps, is safe.
/** The default indexes a `unique` rule makes, which a store may build as the column's own constraint. */
export const uniqueRuleIndexes = new WeakSet<object>()

export const isPlainIdentifier = (value: string) => value.length <= 63 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value)

const fixed = new Set(['access', 'column', 'custom', 'dbName', 'description', 'kayan', 'kind', 'kindTargets', 'label', 'locales', 'name', 'now', 'operators', 'options', 'placeholder', 'prefix', 'schemaTarget', 'sortable', 'suffix', 'target', 'targets', 'rules'])

// Every list holds exactly one store or managed read step, and none of the three
// the runner owns; the effect is read off that one step, so it is never declared.
const effects: Partial<Record<Seal, OperationEffect>> = {
  insert: 'create',
  update: 'update',
  remove: 'delete',
  count: 'read',
  find: 'read',
  findOne: 'read',
  // A bulk list has the effect of the single-row write it runs per row.
  updateMany: 'update',
  deleteMany: 'delete',
  findVersions: 'read',
  findVersionByID: 'read',
  restoreVersion: 'update',
}

// A Map, not a record: a kayan named `constructor` would answer an `in` check on a
// record. Refused before resolving, whatever the kayan declares.
const reservedKayan = new Map([
  [
    // `asas.handler` answers `/api/auth/<provider>` before the router, so this kayan's
    // operations would sit under a taken prefix.
    'auth',
    "asas.handler routes /api/auth to the auth providers before the router, so this kayan's operations would never be reached.",
  ],
  ['mithaq', '`mithaq generate messages` writes a scope of that name and finds it by name, so this kayan would shadow it.'],
  ['project', '`mithaq generate messages` writes a scope of that name and finds it by name, so this kayan would shadow it.'],
  ['screen', 'the catalog derives screen.<name> for every screen, so this kayan\'s keys would be read as screens.'],
])

// In the sealed record at runtime, so one written anyway is refused by name rather
// than reaching a list as `undefined`.
const runnerSteps: Partial<Record<Seal, string>> = {
  defaults: 'the runner fills every default it would have filled, before the list runs',
  validate: 'the runner parses this operation\'s shape before the list runs, and the shape is the operation\'s own "input" key',
  audit: 'audit is a step of the service target\'s "afterSteps"',
}

type Slot = 'afterCommit' | 'afterSteps' | 'beforeSteps' | 'beforeTransaction'

// `beforeSteps` is the service target's alone: a project-wide precondition is no operation's to restate.
const slotsOf = (
  where: string,
  declaration: OperationDeclaration,
  service: LanguageSlots,
  read: boolean,
): Pick<ResolvedOperation, Slot> => {
  const own = declaration as unknown as Partial<Record<Slot, readonly OperationStep<never>[]>>
  const resolved = {
    beforeTransaction: own.beforeTransaction ?? [],
    beforeSteps: read ? [] : service.beforeSteps ?? [],
    afterSteps: own.afterSteps ?? (read ? [] : service.afterSteps ?? []),
    afterCommit: own.afterCommit ?? (read ? [] : service.afterCommit ?? []),
  }
  for (const slot of ['beforeTransaction', 'afterCommit'] as const) {
    if (read && own[slot]) {
      throw new Error(
        `${where} declares "${slot}", and a read opens no transaction, so there is no commit for it to sit outside of.`,
      )
    }
  }
  // Refused rather than dropped: the list would build and never run.
  if (own.beforeSteps) {
    throw new Error(
      `${where} declares "beforeSteps", and that list is the service target's alone, because a project-wide precondition is not an operation's to restate.`,
    )
  }
  for (const [slot, list] of Object.entries(resolved) as [Slot, readonly OperationStep<never>[]][]) {
    if (!Array.isArray(list)) throw new Error(`${where} needs a list of steps in "${slot}", or a function that returns one.`)
    for (const step of list) {
      if (typeof step !== 'function') throw new Error(`${where} has a step in "${slot}" that is not a function.`)
      const held = sealOf(step)
      // `audit` only in `afterSteps`, the one slot inside the transaction after the row
      // was written; outside it, it would get no `tx`.
      if (!held || (held === 'audit' && slot === 'afterSteps')) continue
      if (held === 'audit') {
        throw new Error(
          `${where} writes the "audit" step in "${slot}", and "afterSteps" is audit's slot, where the transaction is open and the row has been written.`,
        )
      }
      const owned = runnerSteps[held]
      throw new Error(
        owned
          ? `${where} writes the "${held}" step in "${slot}", and ${owned}, so no list names it.`
          : `${where} holds the "${held}" step in "${slot}", and a store or managed read step is what the operation itself does, so it belongs in "steps".`,
      )
    }
  }
  return resolved
}

const sealed = (
  kayan: string,
  operation: string,
  declaration: OperationDeclaration,
  service: LanguageSlots,
): ResolvedOperation => {
  const where = `Kayan "${kayan}" operation "${operation}"`
  const list = declaration.steps
  if (!Array.isArray(list)) throw new Error(`${where} needs a list of steps, or a function that returns one.`)
  if (list.some((step) => typeof step !== 'function')) {
    throw new Error(`${where} has a step that is not a function.`)
  }
  const held = list.map(sealOf)
  for (const seal of held) {
    const owned = seal && runnerSteps[seal]
    if (owned) throw new Error(`${where} writes the "${seal}" step, and ${owned}, so a list never names it.`)
  }
  const acts = (seal: Seal | undefined) =>
    !!seal && (storeSeals.includes(seal) || readSeals.includes(seal) || bulkSeals.includes(seal) || versionSeals.includes(seal))
  const at = held.findIndex(acts)
  const acting = held.filter(acts).length
  if (acting !== 1) {
    throw new Error(
      `${where} has ${acting} store or managed read steps, and every operation has exactly one insert, update, remove, updateMany, deleteMany, find, findOne, count, findVersions, findVersionByID or restoreVersion.`,
    )
  }
  const seal = held[at]!
  const effect = effects[seal]!
  const { output, ...rest } = declaration
  const slots = slotsOf(where, declaration, service, effect === 'read')
  // The derived shapes do not exist until every kayan is resolved, so `output` may stay a function for `build`.
  const resolved = (read: { effect: OperationEffect; mode?: ReadMode }): ResolvedOperation => {
    const one = { ...rest, ...slots, steps: list, ...read } as ResolvedOperation
    if (typeof output === 'function') holdOutput(one, output)
    else if (output) one.output = output
    return one
  }
  if (effect === 'read') {
    const modes: Partial<Record<Seal, ReadMode>> = { findOne: 'one', count: 'count', findVersions: 'versions', findVersionByID: 'version' }
    return resolved({ effect, mode: modes[seal] ?? 'many' })
  }
  return resolved({ effect })
}

// `onDelete` is a rule too, so on a relationship it is still checked against every target.
const relationshipKeys = new Set(['filterOptions', 'hasMany', 'mode', 'relationTo'])
const joinKeys = new Set(['defaultLimit', 'defaultSort', 'on', 'relationTo'])
/** Names that reach the prototype rather than a key an actor carries. */
const unsafeKeys = new Set(['__proto__', 'constructor', 'prototype'])
// `!target` stays in front: `isStore` answers `false` for a missing target, which
// would equal the schema half's `false` and pass a name no target answers to.
const targetOf = (who: string, named: string, language: Language, role: 'schema' | 'store') => {
  const target = language.targets[named]
  if (!target || isStore(target) !== (role === 'store')) {
    throw new Error(
      role === 'store'
        ? `${who} names store "${named}", which is not a store: a store target declares capability "store" and has init, connect, transaction, insert, update, remove, find and destroy beside kinds and rules.`
        : `${who} names schema "${named}", which is not a schema target: a schema target has kinds and rules, and does not declare capability "store".`,
    )
  }
  if (role === 'schema' && typeof (target as { derive?: unknown }).derive !== 'function') {
    throw new Error(
      `${who} names "${named}" as its schema target, which declares no derive. A schema target assembles its own create, update, row and list shapes from the kayan's fields.`,
    )
  }
  return target
}

// Decides from data only: a callback with no parameter, or a row table no row
// of which admits the field. Anything taking an actor is left to request time.
const deniesReadOutright = (field: { name: string; access?: { read?: unknown } }): boolean => {
  const read = field.access?.read
  if (typeof read !== 'function') return false
  const table = rowsOfField(read)?.rows
  if (table) {
    const admitted = Object.values(table).some((row) => {
      const list = admissions(row.fields)
      return (list.includes('*') || list.includes(field.name)) && !list.includes(`!${field.name}`)
    })
    return !admitted
  }
  if (read.length > 0) return false
  try {
    return (read as () => unknown)() === false
  } catch {
    return false
  }
}

const globalRuns = new Set(Object.keys(defaultGlobalOperations))

const wrote = (value: unknown) => (value === null ? 'null' : value === undefined ? 'undefined' : `a ${typeof value}`)

const nameOf = (relationTo: unknown) =>
  typeof relationTo === 'function' ? String((relationTo as () => { name: string } | undefined)()?.name) : String(relationTo)

// A row's tenant is one row of the tenant kayan, filled from the session on create and never
// moved, so a field that loosens any of it would let a row be made or moved outside its tenant.
const tenantField = ({ where, field, language }: { where: string; field: RuntimeField; language: Language }): RuntimeField => {
  const target = language.targets.tenant
  if (!isTenant(target)) {
    throw new Error(
      `${where} is bound through targets.tenant, and this language lays down no tenant target. Add tenant: betterAuthTenant({ relationTo, onDelete: 'restrict', organizations }) to its targets, or drop targets.tenant from the field.`,
    )
  }
  const bound = tenantDefaults(language, field)
  const rules = bound.rules ?? {}
  if (bound.targets?.tenant !== true) {
    throw new Error(`${where} writes targets.tenant as ${JSON.stringify(bound.targets?.tenant)}, and a field is bound to the tenant with targets: { tenant: true }, or not at all.`)
  }
  // A store's or schema target's entry is used as built with the rules skipped, so it would
  // drop the not-null and the restricting foreign key the rules say.
  const shaped = Object.keys(bound.targets).find((key) => key !== 'tenant' && language.targets[key] && !isScreen(language.targets[key]))
  if (shaped) {
    throw new Error(`${where} is bound through targets.tenant and writes targets.${shaped}, which would build the field in place of the tenant's rules. Drop targets.${shaped}; a screen's entry is the only other one a tenant field takes.`)
  }
  if (bound.kind !== 'relationship' || bound.hasMany || nameOf(bound.relationTo) !== target.relationTo) {
    throw new Error(
      `${where} is bound through targets.tenant, and a tenant field holds one row of "${target.relationTo}": write it as tenant.field, or as { kind: 'relationship', relationTo: '${target.relationTo}', targets: { tenant: true } } with no hasMany.`,
    )
  }
  for (const [rule, value] of [['required', true], ['index', true], ['onDelete', 'restrict']] as const) {
    if (rules[rule] === value) continue
    throw new Error(`${where} is bound through targets.tenant and declares ${rule} ${JSON.stringify(rules[rule])}, and a tenant field is ${rule}: ${JSON.stringify(value)}. Drop the rule, and the tenant target's own applies.`)
  }
  if (providerOf(bound, 'create') !== 'application' || providerOf(bound, 'update') !== 'never') {
    throw new Error(
      `${where} is bound through targets.tenant and declares providedBy ${JSON.stringify(rules.providedBy)}, and a tenant field is providedBy: { create: 'application', update: 'never' }: the tenant comes from the session and never changes. Drop the rule, and the tenant target's own applies.`,
    )
  }
  if (rules.defaultValue !== undefined) {
    throw new Error(`${where} is bound through targets.tenant and declares defaultValue, and a tenant field is filled from the session alone. Drop defaultValue.`)
  }
  return bound
}

// A key written flat is refused with the nesting spelled out. A node holding both a
// sentence and a group, or nothing, is refused: either reading would destroy copy.
const flattenMessages = (where: string, messages: MessageTree, locales: readonly string[], parts: readonly string[] = []): MessageMap =>
  // `Object.fromEntries`, not assignment: a key named `__proto__` assigned with `[]`
  // runs the setter, so the copy would vanish and the prototype be whatever was written.
  Object.fromEntries(
    Object.entries(messages).flatMap(([key, value]): [string, Localized | LabelFunction][] => {
      const path = [...parts, ...key.split('.')]
      if (key.includes('.')) {
        throw new Error(
          `Kayan "${where}" writes the message key "${path.join('.')}" flat. Nest it under "${key.split('.')[0]}": messages: ${path.map((part) => `{ ${part}: `).join('')}...${' }'.repeat(path.length)}.`,
        )
      }
      if (typeof value === 'function') return [[path.join('.'), value]]
      // A primitive where a node belongs, which only plain data reaches. A bare string
      // would otherwise reach the registry as one opaque string and pass the check.
      if (!value || typeof value !== 'object') {
        throw new Error(
          `Kayan "${where}" writes the message key "${path.join('.')}" as ${wrote(value)}, and a message is one string per declared locale, a group of those, or a function. Write one string per declared locale under it.`,
        )
      }
      const entries = Object.entries(value)
      // Before the sentence-and-group test, which `{ ar: 'x', en: null }` would pass.
      const loose = entries.find(([, one]) => typeof one !== 'string' && typeof one !== 'function' && (!one || typeof one !== 'object'))
      if (loose) {
        throw new Error(
          `Kayan "${where}" writes "${loose[0]}" under the message key "${path.join('.')}" as ${wrote(loose[1])}, and every part of a message is a string, a group of parts, or a function. Write a string there, or drop the part.`,
        )
      }
      const strings = entries.filter(([, one]) => typeof one === 'string').length
      if (strings && strings < entries.length) {
        throw new Error(
          `Kayan "${where}" writes the message key "${path.join('.')}" as a sentence and as a group at once, and a key is one or the other. Give the sentence a part of its own under "${path.join('.')}".`,
        )
      }
      if (!entries.length) {
        // In a `try`: a Proxy's trap or a `constructor` getter can throw, and that would
        // lose the refusal being built.
        let shape = 'an object'
        try {
          const prototype = Object.getPrototypeOf(value) as object | null
          if (prototype === null || prototype === Object.prototype) {
            shape = 'an empty object'
          } else {
            // Read only in this branch: a plain object whose `constructor` throws is an empty object.
            const named = (value as { constructor?: { name?: string } }).constructor?.name
            if (named) shape = `a ${named}`
          }
        } catch {
          // The value would not say what it is, so the sentence says what it can.
        }
        throw new Error(
          `Kayan "${where}" writes the message key "${path.join('.')}" as ${shape}, so it is a sentence in no locale and a group with no parts. Write one string per declared locale under it, or drop the key.`,
        )
      }
      if (strings) {
        // A key that is no declared locale is a part meant to nest, written as a string:
        // `merge` keys by declared locales alone, so it would be silently dropped.
        const stray = locales.length ? entries.find(([locale]) => !locales.includes(locale)) : undefined
        if (stray) {
          throw new Error(
            `Kayan "${where}" writes "${stray[0]}" under the message key "${path.join('.')}", and it is no locale this language declares: ${locales.join(', ')}. Write one string per declared locale under it, or nest "${stray[0]}" as a part of its own.`,
          )
        }
        return [[path.join('.'), value as Localized]]
      }
      return Object.entries(flattenMessages(where, value as MessageTree, locales, path))
    }),
  )

export const resolve = (kayanList: readonly Kayan[], language: Language): ResolvedKayan[] => {
  const pointsAtRow = (kind: string) => language.kinds[kind]?.pointsAtRow === true
  const duplicate = (values: string[]) => values.find((value, at) => values.indexOf(value) !== at)
  const duplicateName = duplicate(kayanList.map(({ name }) => name))
  if (duplicateName) throw new Error(`Kayan name "${duplicateName}" is declared more than once.`)
  const reserved = kayanList.find(({ name }) => reservedKayan.has(name))
  if (reserved) throw new Error(`Kayan name "${reserved.name}" is reserved: ${reservedKayan.get(reserved.name)!}`)
  // The one field name the libraries cannot hold, whatever our records do.
  const proto = kayanList.find(({ fields }) => Object.hasOwn(fields, '__proto__'))
  if (proto) throw new Error(`Kayan "${proto.name}" field "__proto__" is reserved: Zod drops its value and drizzle's pgTable assigns it with Object.assign, which replaces the table's prototype.`)
  // The push and the pull read a table name as a glob, so `*`, `?`, `[` or a leading
  // `!` would widen the filter to tables the language did not build.
  const glob = kayanList.find(({ name, dbName }) => !isPlainIdentifier(dbName ?? name))
  if (glob) throw new Error(`Kayan "${glob.name}" asks for the table name ${JSON.stringify(glob.dbName ?? glob.name)}, which is not a plain SQL identifier: letters, digits and underscores, not starting with a digit, at most 63 bytes. Give the kayan a dbName that is.`)
  const duplicateTable = duplicate(kayanList.map(({ name, dbName }) => dbName ?? name))
  if (duplicateTable) throw new Error(`Table name "${duplicateTable}" is declared more than once.`)
  // For a table written as plain data, which `kind` does not type. A rule may ship no
  // sentence; every kind refuses the value it is handed.
  for (const [name, kind] of Object.entries(language.kinds as Record<string, { message?: unknown }>)) {
    if (!kind.message) {
      throw new Error(`The language's kind "${name}" declares no message, so a value it refuses has no sentence to show.`)
    }
  }
  // A typo would otherwise exclude nothing in silence.
  for (const [name, one] of Object.entries(language.rules)) {
    const missing = one.excludes?.find((other) => !Object.hasOwn(language.rules, other))
    if (missing) {
      throw new Error(`The language's rule "${name}" excludes "${missing}", which is not a rule the language names.`)
    }
  }
  const resolvedIndexes = new Map<Kayan, CompoundIndex[]>()
  for (const kayan of kayanList) {
    // Every operation that addresses a row compares the id column, so a kayan with none
    // reaches the store with both operands undefined.
    if (!kayan.fields.id) {
      throw new Error(
        `Kayan "${kayan.name}" declares no field "id", and every operation that addresses a row does so by that id. Spread "defaultFields", or declare "id".`,
      )
    }
    const columns = Object.entries(kayan.fields)
      .filter(([, field]) => field.kind !== 'join')
      .map(([name, field]) => field.dbName ?? (field.relationTo ? `${snakeCase(name)}_id` : snakeCase(name)))
    const duplicateColumn = duplicate(columns)
    if (duplicateColumn) {
      throw new Error(`Kayan "${kayan.name}" column name "${duplicateColumn}" is declared more than once.`)
    }
    const owner = Object.keys(kayan.fields).find((name) => kayan.fields[name]!.targets?.tenant !== undefined)
    // Local sign-in finds an account by its email and tokens alone, so per-tenant values would
    // let one tenant's member register another's address and either row answer.
    if (owner && kayan.auth) {
      throw new Error(
        `Kayan "${kayan.name}" authenticates accounts and places tenant field "${owner}", and an account is one identity across every organization, looked up by its email and tokens alone. Drop the tenant field: an account kayan is shared.`,
      )
    }
    // A file's key is the address of one object in a store every tenant shares, so it stays unique
    // across the table: per tenant, two rows could name one object and serve or delete each other's.
    const filed = Object.keys(language.targets).some((name) => isStorage(language.targets[name]) && kayan.targets?.[name] !== undefined)
    const unique = Object.entries(kayan.fields)
      .filter(([, field]) => field.rules?.unique === true && field.kind !== 'join' && !field.hasMany)
      .map(([name]) => name)
    // Unique within the tenant on a tenant-owned kayan, so one tenant never learns that another
    // holds a value, nor takes one another wants. A join and a `hasMany` field are refused for
    // `unique` further down, by name.
    const defaults = unique.map((name) => {
      if (kayan.fields[name]!.rules?.localized) {
        throw new Error(
          `Kayan "${kayan.name}" field "${name}" is unique and localized, and a unique index is over one column while a localized field is one column per locale. Drop one of the two rules.`,
        )
      }
      const index = { fields: owner && name !== owner && !(filed && name === 'key') ? [owner, name] : [name], unique: true }
      uniqueRuleIndexes.add(index)
      return index
    })
    const declared = kayan.indexes as unknown
    if (declared !== undefined && typeof declared !== 'function' && !Array.isArray(declared)) {
      throw new Error(`Kayan "${kayan.name}" writes indexes that are not a list. Write indexes: [{ fields: ['a', 'b'] }].`)
    }
    const listed = typeof declared === 'function' ? declared({ defaults }) : [...(declared ?? []), ...defaults]
    if (!Array.isArray(listed)) {
      throw new Error(`Kayan "${kayan.name}" indexes answered ${wrote(listed)}, and the function answers the whole list: indexes: ({ defaults }) => [...defaults].`)
    }
    // Expanded here, so every store builds the flat list it always built. Each index keeps the
    // name a refusal calls it by.
    const names: string[] = []
    const indexes = listed.flatMap((entry: unknown, at): unknown[] => {
      if (uniqueRuleIndexes.has(entry as object)) {
        names.push(`the default unique index over "${(entry as CompoundIndex).fields.join('", "')}"`)
        return [entry]
      }
      if (!entry || typeof entry !== 'object' || !Object.hasOwn(entry, 'within')) {
        names.push(`indexes[${at}]`)
        return [entry]
      }
      const where = `Kayan "${kayan.name}" indexes[${at}]`
      const { within, unique: uniques = [], index: plain = [] } = entry as { within: unknown; unique?: unknown; index?: unknown }
      // Only the tenant field: a group is the tenant's own uniqueness, and a plain entry says the rest.
      if (!owner || within !== owner) {
        throw new Error(
          owner
            ? `${where} is a group within ${JSON.stringify(within)}, and a group is within the kayan's tenant field, "${owner}". Write within: '${owner}', or write each index as { fields: [...] }.`
            : `${where} is a group within ${JSON.stringify(within)}, and the kayan places no tenant field, so its rows are within no tenant. Write each index as { fields: [...] }.`,
        )
      }
      const stray = Object.keys(entry).find((key) => key !== 'within' && key !== 'unique' && key !== 'index')
      if (stray !== undefined) throw new Error(`${where} writes "${stray}", and a group takes within, unique and index alone.`)
      for (const [key, list] of [['unique', uniques], ['index', plain]] as const) {
        if (!Array.isArray(list)) {
          throw new Error(`${where} writes ${key} as ${JSON.stringify(list)}, and a group's unique and index are lists of fields and of lists of fields: unique: ['a', ['b', 'c']].`)
        }
        // A typo otherwise, and as a unique one it would hold the tenant to a single row.
        if (list.some((fields) => Array.isArray(fields) && !fields.length)) {
          throw new Error(`${where} writes an empty list in ${key}, which would be an index over "${owner}" alone. Name the fields it is over, or drop the empty list.`)
        }
      }
      const group = [
        ...(uniques as unknown[]).map((fields) => ({ fields: [within, ...[fields].flat()], unique: true })),
        ...(plain as unknown[]).map((fields) => ({ fields: [within, ...[fields].flat()] })),
      ]
      if (!group.length) {
        throw new Error(`${where} is a group within "${owner}" that names no index. Write unique: ['a', ['b', 'c']], index: ['d'], or both.`)
      }
      for (const one of group) names.push(`indexes[${at}]'s index over "${one.fields.join('", "')}"`)
      return group
    })
    resolvedIndexes.set(kayan, indexes as CompoundIndex[])
    // A join, a `hasMany` relationship and a localized field hold no single column of
    // this table, so no index covers them. Checked here for a kayan written as plain data.
    const seen = new Map<string, number>()
    indexes.forEach((index: unknown, at) => {
      const where = `Kayan "${kayan.name}" ${names[at]}`
      const { fields, unique, nullsNotDistinct } = (index ?? {}) as { fields?: unknown; unique?: unknown; nullsNotDistinct?: unknown }
      if (!Array.isArray(fields) || !fields.length) {
        throw new Error(`${where} names no field, and an index is built over at least one. Write it as { fields: ['a', 'b'] }.`)
      }
      // A misspelt `unique` would otherwise build an index that is not.
      const stray = Object.keys(index as object).find((key) => key !== 'fields' && key !== 'unique' && key !== 'nullsNotDistinct')
      if (stray !== undefined) throw new Error(`${where} writes "${stray}", and an index takes fields, unique and nullsNotDistinct alone.`)
      if (unique !== undefined && typeof unique !== 'boolean') {
        throw new Error(`${where} writes unique as ${JSON.stringify(unique)}, and unique is true or false.`)
      }
      if (nullsNotDistinct !== undefined && typeof nullsNotDistinct !== 'boolean') {
        throw new Error(`${where} writes nullsNotDistinct as ${JSON.stringify(nullsNotDistinct)}, and nullsNotDistinct is true or false.`)
      }
      if (nullsNotDistinct !== undefined && unique !== true) {
        throw new Error(
          `${where} writes nullsNotDistinct without unique: true, and only a unique index treats nulls as equal or distinct. Add unique: true, or drop nullsNotDistinct.`,
        )
      }
      for (const name of fields) {
        const field = typeof name === 'string' && Object.hasOwn(kayan.fields, name) ? kayan.fields[name]! : undefined
        if (!field) throw new Error(`${where} names ${JSON.stringify(name)}, which is no field of the kayan.`)
        const notColumn = field.hasMany
          ? 'a relationship with hasMany, which the store holds as a join table and not as a column of this kayan'
          : field.kind === 'join'
            ? 'a join, which is no column of this kayan: its rows are the other kayan\'s'
            : field.rules?.localized
              ? 'which is localized and so one column per locale rather than one column'
              : undefined
        if (notColumn) throw new Error(`${where} names "${name}", ${notColumn}. Drop it from the index.`)
      }
      const twice = duplicate(fields as string[])
      if (twice) throw new Error(`${where} names "${twice}" twice.`)
      const key = JSON.stringify(fields)
      if (seen.has(key)) {
        throw new Error(
          `Kayan "${kayan.name}" ${names[seen.get(key)!]} and ${names[at]} are over the same fields in the same order, so they would be one index built twice. Keep one; a unique index serves every read the other would.`,
        )
      }
      seen.set(key, at)
    })
    const bare = unique.find((name) => !(indexes as CompoundIndex[]).some((index) => index.unique && index.fields.includes(name)))
    if (bare) {
      throw new Error(
        `Kayan "${kayan.name}" field "${bare}" is unique, and no unique index of the kayan covers it, so nothing would refuse a second row of one value. Keep its default in indexes, or drop unique.`,
      )
    }
  }
  const service = serviceTargetOf(language)!
  // Checked on the target itself, so a wrong default is refused where it is written.
  targetOf('The service target', service.store, language, 'store')
  targetOf('The service target', service.schema, language, 'schema')
  // One window per build: a second versions target would leave each kayan reading whichever came first.
  const versionTargets = Object.entries(language.targets).filter(([, target]) => isVersions(target))
  if (versionTargets.length > 1) {
    throw new Error(`Targets "${versionTargets.map(([key]) => key).join('" and "')}" both declare capability "versions", and a build has at most one versions target. Drop one of them.`)
  }
  const versioning = versionTargets[0] as [string, { max: number }] | undefined
  // One key, so the target a field's `targets.tenant` binds to is never a guess.
  const tenantTarget = language.targets.tenant
  const misnamed = Object.entries(language.targets).find(([name, target]) => isTenant(target) !== (name === 'tenant'))
  if (misnamed) {
    throw new Error(
      misnamed[0] === 'tenant'
        ? `Target "tenant" declares capability "${String(misnamed[1].capability)}", and the key "tenant" is the tenant target's, which a field binds to through targets.tenant. Name this target for what it is.`
        : `Target "${misnamed[0]}" declares capability "tenant" and has to be named "tenant" in targets, because a field binds to it through targets.tenant.`,
    )
  }
  if (isTenant(tenantTarget) && tenantTarget.onDelete !== 'restrict') {
    throw new Error(`The tenant target declares onDelete ${JSON.stringify(tenantTarget.onDelete)}, and a tenant takes onDelete: 'restrict' alone.`)
  }
  const byName = new Map(kayanList.map((kayan) => [kayan.name, kayan]))
  const resolved = kayanList.map((kayan) => {
    if (kayan.targets && Object.hasOwn(kayan.targets, 'tenant')) {
      throw new Error(
        `Kayan "${kayan.name}" writes targets.tenant, and a kayan is tenant-owned by the field it places, tenant.field, and shared without one. Drop targets.tenant from the kayan.`,
      )
    }
    const fields = Object.fromEntries(
      Object.entries(kayan.fields).map(([name, field]) => {
        if (field.targets?.tenant !== undefined) return [name, tenantField({ where: `Kayan "${kayan.name}" field "${name}"`, field, language })]
        // A spread that writes its own `targets` drops the binding and keeps the rest of
        // `tenant.field`, which would quietly leave the kayan shared.
        const provided = field.rules?.providedBy as Record<string, unknown> | undefined
        if (isTenant(tenantTarget) && field.kind === 'relationship' && nameOf(field.relationTo) === tenantTarget.relationTo
          && provided?.create === 'application' && provided.update === 'never' && Object.keys(provided).length === 2) {
          throw new Error(`Field "${kayan.name}.${name}" looks like the tenant field but is not bound to the tenant target, so its kayan would be shared. Add targets: { tenant: true } to it.`)
        }
        return [name, field]
      }),
    )
    const owners = Object.keys(fields).filter((name) => fields[name]!.targets?.tenant !== undefined)
    if (owners.length > 1) {
      throw new Error(`Kayan "${kayan.name}" binds fields "${owners.join('" and "')}" to the tenant, and a row belongs to one tenant. Keep one of them.`)
    }
    // Refused at the root, where `operations` would leave the kayan answering nothing and
    // `store` would land writes in another store. Checked for kayan written as plain data.
    for (const key of kayanServiceKeys) {
      if (!Object.hasOwn(kayan, key)) continue
      throw new Error(
        `Kayan "${kayan.name}" writes "${key}" at its root, and it is a key of the kayan's service target now. Write it as targets: { service: { ${key}: ... } }.`,
      )
    }
    const own = (kayan.targets?.service ?? {}) as KayanService
    for (const key of Object.keys(own)) {
      if ((kayanServiceKeys as readonly string[]).includes(key)) continue
      throw new Error(
        `Kayan "${kayan.name}" writes "targets.service.${key}", which is no key of a kayan's service target. A kayan writes ${kayanServiceKeys.join(', ')} there.`,
      )
    }
    if (typeof own.operations === 'function') {
      throw new Error(
        `Kayan "${kayan.name}" writes its operations as a function, which only defineKayan and defineGlobal run, since they know the defaults it is handed. Declare it with defineKayan, or write its operations as an object: { ...defaultOperations, archive }.`,
      )
    }
    return {
      ...kayan,
      // Flattened here, so every reader of a resolved kayan sees the key space a generated file carries.
      ...(kayan.messages && { messages: flattenMessages(kayan.name, kayan.messages, language.locales ?? []) }),
      table: kayan.dbName ?? kayan.name,
      indexes: resolvedIndexes.get(kayan)!,
      store: own.store ?? service.store,
      schema: own.schema ?? service.schema,
      // Written onto the kayan, because the runner and the managed reads hold the resolved kayan, not the language.
      ...(service.softDelete && kayan.fields[service.softDelete] ? { softDelete: service.softDelete } : {}),
      // Run again for a kayan written as plain data. `false` would remove nothing from
      // the kayan's own record, so it is refused by name.
      operations: Object.fromEntries(
        Object.entries(resolveOperations(own.operations, service)).filter(([operation, declaration]) => {
          if ((declaration as unknown) === false) {
            throw new Error(
              `Kayan "${kayan.name}" operation "${operation}" is false, and false is no operation. Leave "${operation}" out of the object instead: const { ${operation}, ...rest } = defaultOperations.`,
            )
          }
          if (declaration && typeof declaration === 'object' && 'steps' in declaration) return true
          throw new Error(`Kayan "${kayan.name}" operation "${operation}" is not an operation declaration.`)
        }),
      ) as Record<string, OperationDeclaration>,
      ...(owners.length && { tenant: owners[0] }),
      // No prototype, so a query naming `toString` finds no field rather than a function.
      fields: Object.assign(Object.create(null), Object.fromEntries(
        Object.entries(fields).map(([name, field]) => [
          name,
          {
            ...field,
            name,
            // Filled here, so every target's `required` rule always runs.
            rules: {
              ...field.rules,
              required: field.rules?.required ?? false,
              // A join holds no column here, so `providedBy: never` keeps the key off every write shape.
              ...(field.kind === 'join' && { providedBy: { create: 'never', update: 'never' } }),
              // A required field and a set restrict, since neither has a null to set; any other takes its kind's default.
              ...(pointsAtRow(field.kind) && field.relationTo && {
                onDelete: field.rules?.onDelete ?? (field.rules?.required || field.hasMany ? 'restrict' : language.kinds[field.kind]!.onDelete),
              }),
            },
            // A join builds no column, but takes a name so the one place that prints it prints no blank.
            column: field.dbName ?? (pointsAtRow(field.kind) && field.relationTo ? `${snakeCase(name)}_id` : snakeCase(name)),
            // A target's maps take a `ResolvedField` and nothing else, so the facts they need are written onto it.
            kayan: kayan.name,
            schemaTarget: own.schema ?? service.schema,
            // Written on every field, so a `locales` a declaration wrote itself is dropped.
            locales: field.rules?.localized ? language.locales : undefined,
            now: language.kinds[field.kind]?.now,
            kindTargets: language.kinds[field.kind]?.targets,
            operators: language.kinds[field.kind]?.operators,
            sortable: language.kinds[field.kind]?.sortable,
            target: typeof field.relationTo === 'string' ? byName.get(field.relationTo) : field.relationTo?.(),
          },
        ]),
      )),
    }
  }) as unknown as ResolvedKayan[]

  // A second pass, since two kayan may point at each other.
  const resolvedByName = new Map(resolved.map((kayan) => [kayan.name, kayan]))
  // The targets that shape a field; the access, service and screen targets shape none.
  const targets = Object.entries(language.targets).filter(
    ([, target]) => !isAccess(target) && !isScreen(target) && !isService(target) && !isVersions(target) && !isStorage(target) && !isTenant(target),
  ) as [string, FieldTarget][]
  // A `targets.<name>` naming no target is a typo, not an override. `service` is left
  // out: only a kayan writes it, and one written elsewhere is refused by name.
  const targetNames = new Set(Object.entries(language.targets).filter(([, target]) => !isService(target)).map(([name]) => name))
  const kayanTargetNames = new Set([...targetNames, ...Object.entries(language.targets).filter(([, target]) => isService(target)).map(([name]) => name)])
  const optionsNamed = (where: string, kind: string, field: { options?: readonly { value: string; label: unknown }[] }) => {
    if (field.options && kind !== 'text' && kind !== 'textArray') throw new Error(`${where} options belong on a text field or a list of text.`)
    if (field.options) {
      const values = new Set<string>()
      for (const option of field.options) {
        if (typeof option.value !== 'string' || values.has(option.value)) throw new Error(`${where} options need distinct string values.`)
        values.add(option.value)
        if (!option.label || typeof option.label !== 'object' ||
          (language.locales ?? []).some((locale) => typeof (option.label as Record<string, unknown>)[locale] !== 'string')) {
          throw new Error(`${where} option "${option.value}" needs a label in every declared locale.`)
        }
      }
    }
  }
  const affixesNamed = (where: string, kind: string, field: { prefix?: unknown; suffix?: unknown; placeholder?: unknown }) => {
    for (const key of ['prefix', 'suffix', 'placeholder'] as const) {
      const copy = field[key]
      // A function is the label hatch, resolved by the project's own runtime.
      if (copy === undefined || typeof copy === 'function') continue
      if (key !== 'placeholder' && !['text', 'number', 'integer', 'decimal'].includes(kind)) throw new Error(`${where} has a ${key}, and kind "${kind}" takes none; only a text, number, integer or decimal field does.`)
      for (const locale of language.locales ?? []) {
        if (typeof (copy as Record<string, unknown> | null)?.[locale] !== 'string') throw new Error(`${where} ${key} is short of locale "${locale}".`)
      }
    }
  }
  const declaredTargets = (where: string, wrote: Record<string, unknown> | undefined, known = targetNames) => {
    for (const name of Object.keys(wrote ?? {})) {
      if (known.has(name)) continue
      // Not "no such target": the build has one. It is a key nobody reads.
      if (isService(language.targets[name])) {
        throw new Error(
          `${where} writes "targets.${name}", and nothing reads it: the keys a service target takes are a kayan's own, which are ${kayanServiceKeys.join(', ')}. Write them on the kayan, or drop this key.`,
        )
      }
      throw new Error(
        `${where} writes "targets.${name}", which is no target of this build. The targets are ${[...known].join(', ')}.`,
      )
    }
  }
  for (const kayan of resolved) {
    const store = targetOf(`Kayan "${kayan.name}"`, kayan.store, language, 'store') as Store
    targetOf(`Kayan "${kayan.name}"`, kayan.schema, language, 'schema')
    for (const field of Object.values(kayan.fields)) {
      const where = `Kayan "${kayan.name}" field "${field.name}"`
      declaredTargets(where, field.targets)
      // The field found must be a relationship pointing back here, or the join would read
      // a column that is no pointer back and answer another row's rows.
      if (field.kind === 'join') {
        if (!field.relationTo) {
          throw new Error(`${where} is a join with no relationTo, so it points at nothing.`)
        }
        const target = field.target && resolvedByName.get(field.target.name)
        if (!target) {
          throw new Error(`${where} points at kayan "${nameOf(field.relationTo)}", which is not in the list passed to buildAsas. Add it to that list.`)
        }
        field.target = target
        const back = Object.hasOwn(target.fields, field.on ?? '') ? target.fields[field.on!] : undefined
        if (!back || back.kind !== 'relationship' || back.hasMany || back.target?.name !== kayan.name) {
          throw new Error(
            `${where} joins kayan "${target.name}" on "${field.on}", which is not a relationship back to "${kayan.name}". Name the field on "${target.name}" that holds this row's id.`,
          )
        }
        // A field no actor may read would turn every read of this kayan at a depth into that child's 403.
        if (deniesReadOutright(back)) {
          throw new Error(
            `${where} joins kayan "${target.name}" on "${field.on}", whose read access is denied outright, so every read of this kayan at a depth would be refused 403.`,
          )
        }
        // A join's page is a page of the child's `find`, so it is held to what a caller may ask for.
        if (field.defaultLimit !== undefined && !(Number.isInteger(field.defaultLimit) && field.defaultLimit >= 1 && field.defaultLimit <= service.maxLimit)) {
          throw new Error(`${where} has defaultLimit ${JSON.stringify(field.defaultLimit)}, and a join's page is a whole number from 1 to service.maxLimit ${service.maxLimit}.`)
        }
        // Held at build to what the child's read takes, or a read past it would lose every
        // parent page at a depth to the child's 400 or 403.
        if (field.defaultSort !== undefined) {
          const sort = field.defaultSort
          if (typeof sort !== 'string' || !/^-?[A-Za-z0-9_]+$/.test(sort)) {
            throw new Error(`${where} has defaultSort ${JSON.stringify(sort)}, and a join's sort is one field of kayan "${target.name}", optionally prefixed with "-".`)
          }
          const name = sort.replace(/^-/, '')
          if (!Object.hasOwn(target.fields, name)) throw new Error(`${where} has defaultSort "${sort}", which is no field of kayan "${target.name}".`)
          if (unsortable(target.fields[name]!) || deniesReadOutright(target.fields[name]!)) {
            throw new Error(`${where} has defaultSort "${sort}", and kayan "${target.name}" cannot be ordered by "${name}".`)
          }
        }
        // Read off the declaration: `resolve` has already written its own `providedBy` above.
        const declaredRules = byName.get(kayan.name)?.fields[field.name]?.rules
        const columnRule = (['defaultValue', 'index', 'localized', 'onDelete', 'providedBy', 'unique'] as const).find(
          (rule) => declaredRules?.[rule] !== undefined,
        )
        if (columnRule) {
          throw new Error(
            `${where} is a join, which holds no column of this kayan and no value a caller sends, so rule "${columnRule}" would build nothing. Declare it on kayan "${target.name}", or drop it.`,
          )
        }
      }
      if (pointsAtRow(field.kind)) {
        if (!language.kinds[field.kind]!.onDelete) {
          throw new Error(`${where} has kind "${field.kind}", which points at a row and says no onDelete default. Give the kind its own onDelete.`)
        }
        if (!field.relationTo) {
          throw new Error(`${where} is a ${field.kind} with no relationTo, so it points at nothing.`)
        }
        const declared = typeof field.relationTo === 'function' ? field.relationTo() : undefined
        if (declared && byName.has(declared.name) && byName.get(declared.name) !== declared) {
          throw new Error(
            `${where} points at an unrelated kayan object named "${declared.name}" instead of the registered kayan.`,
          )
        }
        const target = field.target && resolvedByName.get(field.target.name)
        if (!target) {
          throw new Error(`${where} points at kayan "${nameOf(field.relationTo)}", which is not in the list passed to buildAsas. Add it to that list.`)
        }
        field.target = target
        // Refused on every value rather than carried unread.
        if (Object.hasOwn(field, 'mode')) {
          throw new Error(
            `${where} carries "mode", which a field does not take: a relationship points at one row, and "hasMany: true" makes it hold a set.`,
          )
        }
        // Its delete would fail in the database on the not-null column instead.
        if (!field.hasMany && field.rules?.required && field.rules.onDelete === 'set null') {
          throw new Error(`${where} is required and declares onDelete "set null", and a required column holds no null. Write "restrict" or "cascade".`)
        }
        // A rule that silently builds nothing is what this file exists to prevent.
        // `required` is not one: the schema target reads it off the array.
        if (field.hasMany) {
          if (field.rules?.onDelete === 'set null') {
            throw new Error(
              `${where} is a relationship with hasMany and onDelete "set null", and a set's join row holds no null. Write "restrict", which keeps the row while a set names it, or "cascade", which takes it out of every set.`,
            )
          }
          const columnRule = (['defaultValue', 'index', 'unique'] as const).find(
            (rule) => field.rules?.[rule] !== undefined,
          )
          if (columnRule) {
            throw new Error(
              `${where} is a relationship with hasMany, which the store holds as a join table and not as a column of this kayan, so rule "${columnRule}" would build nothing. Declare it on the kayan this field points at, or drop it.`,
            )
          }
        }
        // No store can reference a row another store holds.
        if (target.store !== kayan.store) {
          throw new Error(
            `${where} points at kayan "${target.name}" in store "${target.store}", and this kayan is in store "${kayan.store}". A relationship cannot cross stores: declare the id as a text or uuid field and join in the app.`,
          )
        }
        // Unreachable while every kayan without an `id` is refused above; it guards a target
        // reaching this pass some other way.
        if (!target.fields.id) {
          throw new Error(
            `${where} points at kayan "${target.name}", which declares no field "id", so there is no id for the foreign key to take its type from.`,
          )
        }
      }
      optionsNamed(where, field.kind, field)
      affixesNamed(where, field.kind, field)
      for (const [screen, block] of Object.entries(field.targets ?? {})) {
        if (!isScreen(language.targets[screen])) continue
        const drawn = block as ScreenField
        const at = `${where} targets.${screen}`
        // The row it offers would be refused by the read every time it ran.
        if (drawn.filter === true && deniesReadOutright(field)) {
          throw new Error(`${at}.filter is set and the field denies read outright, so it offers a filter no actor can ever use.`)
        }
        // A field the read refuses `like` on would make every search a 400, and one no actor may read a 403.
        if (drawn.searchable === true) {
          if (!['email', 'text'].includes(field.kind)) {
            throw new Error(`${at}.searchable is set, and its kind "${field.kind}" cannot take the "like" operator; only "text" and "email" can.`)
          }
          if (field.rules?.localized) throw new Error(`${at}.searchable is set and the field is localized, and a search runs one "like" over one column.`)
          if (deniesReadOutright(field)) throw new Error(`${at}.searchable is set and the field denies read outright, so every search over it would be refused 403.`)
        }
        // Refused on every kind rather than carried unread.
        for (const key of ['allowCreate', 'defaultColumns', 'inline'] as const) {
          if (Object.hasOwn(block as object, key)) {
            throw new Error(`${at}.${key} is set, and it draws nothing: a one-to-many relationship is a page's list node now, { list: { of, where } }.`)
          }
        }
      }
      // `primary` is the store's own, never a rule a field carries, so the
      // field named `id` is where its entry is checked for.
      if (field.name === 'id' && !store.rules.primary) {
        throw new Error(
          `${where} is the primary key, and "primary" has no entry in the "${kayan.store}" target's rules.`,
        )
      }
      // Without this the mismatch is Postgres refusing the pushed schema at connect.
      if (field.name === 'id') {
        for (const [name, target] of targets) {
          if (target.idKinds && !target.idKinds.includes(field.kind)) {
            throw new Error(
              `${where} is the primary key with kind "${field.kind}", which the "${name}" target builds no id of. An id may be ${target.idKinds.map((one) => `"${one}"`).join(', ')}.`,
            )
          }
        }
        // Every foreign key to the id is built without its rules, so `maxLength` on the
        // id would make it `varchar(n)` against plain `text` keys.
        if (typeof field.rules?.maxLength === 'number') {
          throw new Error(
            `${where} is the primary key, and "maxLength" on it would build a column and a shape no foreign key pointing at it shares. Declare the maximum on a field that is not the id.`,
          )
        }
      }
      // Both sizes or neither: a scale past the precision would leave the whole part no digit.
      if (field.kind === 'decimal') {
        const { precision, scale } = field.rules ?? {}
        if (typeof precision !== typeof scale) {
          throw new Error(`${where} declares ${typeof precision === 'number' ? 'precision' : 'scale'} and needs ${typeof precision === 'number' ? 'scale' : 'precision'} too, or neither.`)
        }
        if (typeof precision === 'number' && Number(scale) > precision) {
          throw new Error(`${where} needs a scale no greater than its precision.`)
        }
      }
      // Never a silent skip: a kind has an entry on every target or throws.
      for (const [name, target] of targets) {
        if (!implementationOf({ table: target.kinds, name: field.kind, own: language.kinds[field.kind]?.targets, type: target.type })) {
          throw new Error(
            `${where} has kind "${field.kind}", which has no entry in the "${name}" target's kinds${target.type ? ` and carries none of its own under targets.${target.type}` : ''}.`,
          )
        }
      }
      // A key that is neither a rule nor one of its kind's own is a typo, and says so.
      const own = field.kind === 'join' ? joinKeys : pointsAtRow(field.kind) ? relationshipKeys : undefined
      for (const key of Object.keys(field)) {
        if (fixed.has(key) || own?.has(key)) continue
        if (relationshipKeys.has(key) || joinKeys.has(key)) {
          throw new Error(
            `${where} has kind "${field.kind}" and carries key "${key}", which only a ${relationshipKeys.has(key) ? 'relationship' : 'join'} may carry.`,
          )
        }
        throw new Error(`${where} carries key "${key}", which is not a field key; put rules under "rules".`)
      }
      for (const [key, value] of Object.entries(field.rules ?? {})) {
        if (!Object.hasOwn(language.rules, key)) {
          throw new Error(`${where} carries nested rule "${key}", which is not a rule the language names.`)
        }
        if (!language.rules[key]!.accepts(value)) {
          throw new Error(`${where} nested rule "${key}" has an invalid value type.`)
        }
        const accepted = language.kinds[field.kind]?.rules
        if (!accepted?.includes(key)) {
          throw new Error(`${where} has kind "${field.kind}" which does not accept nested rule "${key}".`)
        }
        // Refused here rather than at the first write it would fill.
        if ((key === 'defaultNow' || key === 'nowOnUpdate') && value === true && !language.kinds[field.kind]!.now) {
          throw new Error(`${where} nested rule "${key}" does not match kind "${field.kind}", which says no moment to write.`)
        }
        // `nowOnUpdate` is the runner supplying the value on every update, so any other
        // provider contradicts it.
        if (key === 'nowOnUpdate' && value === true && providerOf(field, 'update') !== 'application') {
          throw new Error(
            `${where} declares "nowOnUpdate", which says the runner supplies the value on every update, and its providedBy.update is "${providerOf(field, 'update')}". Declare providedBy: { update: 'application' }, or drop "nowOnUpdate".`,
          )
        }
        if (key === 'defaultNow' && value === true && providerOf(field, 'create') === 'never') {
          throw new Error(
            `${where} declares "defaultNow", which says the runner fills the value a create leaves out, and its providedBy.create is "never". Declare providedBy: { create: 'application' } or leave create to the client, or drop "defaultNow".`,
          )
        }
        // The rule's accepted type is `number | string` on every kind, so this keeps `min: '3'` off a number.
        if ((key === 'min' || key === 'max') && !language.kinds[field.kind]!.accepts(value)) {
          throw new Error(`${where} nested rule "${key}" does not match kind "${field.kind}".`)
        }
        // The target's map order would decide which of the pair ran last, which nothing the
        // field said. A rule switched off with `false` is not declared.
        const excluded = value === false ? undefined : language.rules[key]!.excludes?.find(
          (other) => field.rules?.[other] !== undefined && field.rules[other] !== false,
        )
        if (excluded) {
          throw new Error(
            `${where} declares both "${key}" and "${excluded}", and the two cannot both hold: "${key}" excludes "${excluded}". Declare one of the two.`,
          )
        }
        // A lower bound above its upper bound refuses every write naming a reasonable-looking
        // rule. A decimal compares as the value it is, not as text.
        if (key === 'min' || key === 'minLength' || key === 'minRows') {
          const upper = key === 'min' ? 'max' : key === 'minLength' ? 'maxLength' : 'maxRows'
          const most = field.rules?.[upper]
          const impossible =
            most !== undefined &&
            (field.kind === 'decimal' && key === 'min'
              ? compareDecimals(String(value), String(most)) > 0
              : typeof value === 'number' && typeof most === 'number' ? value > most : String(value) > String(most))
          if (impossible) {
            throw new Error(
              `${where} declares "${key}" ${JSON.stringify(value)} and "${upper}" ${JSON.stringify(most)}, and no value is both at once. Name a "${key}" no greater than the "${upper}".`,
            )
          }
        }
        // mithaq resolves no locale, so one column would be a guess at which locale the value is in.
        if (key === 'localized' && value === true && !language.locales?.length) {
          throw new Error(
            `${where} carries nested rule "localized", and this language declares no locales. Name them on defineMithaq, the way roles are named, so every target knows which columns and which keys a localized field has.`,
          )
        }
        // A path's second segment reads as a locale or as a field of what the field points at,
        // never both; a project kind named `relationship` could otherwise carry both.
        if (key === 'localized' && value === true && field.relationTo) {
          throw new Error(
            `${where} carries nested rule "localized" and a "relationTo", and a field is one or the other: a query path's second segment reads as a locale of this field or as a field of the kayan it points at, and a field carrying both would make the path mean two things.`,
          )
        }
        // The default would reach a localized field as a string where the shape wants an
        // object keyed by locale, so the create it serves is refused.
        if (key === 'localized' && value === true && field.rules?.defaultValue !== undefined) {
          throw new Error(
            `${where} declares both "localized" and a defaultValue, and the two contradict: the default is one literal on every locale column, and the defaults step then writes that literal where the shape wants an object keyed by locale. Declare one of the two.`,
          )
        }
        if (key === 'defaultValue') refuseLiteral(value, `${where} nested rule "defaultValue"`)
        // Only the key is checked here: one an actor could carry, never a prototype name.
        if (key === 'defaultValue' && isRef(value) && unsafeKeys.has(value.$user)) {
          throw new Error(
            `${where} nested rule "defaultValue" names the actor key "${value.$user}", which no actor carries.`,
          )
        }
        if (
          key === 'defaultValue' &&
          !isRef(value) &&
          !language.kinds[field.kind]!.accepts(value)
        ) {
          throw new Error(`${where} nested rule "defaultValue" does not match kind "${field.kind}".`)
        }
        for (const [name, target] of targets) {
          if (!target.rules[key]) {
            throw new Error(`${where} carries nested rule "${key}", which has no entry in the "${name}" target's rules.`)
          }
        }
      }
    }
    // An operation's own relationship input draws a picker over the named kayan, so a
    // name no kayan carries is refused rather than drawn over nothing.
    for (const [operation, declaration] of Object.entries(kayan.operations)) {
      declaredTargets(`Kayan "${kayan.name}" operation "${operation}"`, declaration.targets)
      const inputs = Object.entries(declaration.targets ?? {}).flatMap(([screen, block]) =>
        isScreen(language.targets[screen]) ? Object.entries((block as { fields?: Record<string, RuntimeField> }).fields ?? {}) : [],
      )
      for (const [name, field] of inputs) {
        const where = `Kayan "${kayan.name}" operation "${operation}" field "${name}"`
        declaredTargets(where, field.targets)
        optionsNamed(where, field.kind, field)
        affixesNamed(where, field.kind, field)
        if (field.kind !== 'relationship') continue
        const target = typeof field.relationTo === 'function' ? field.relationTo().name : field.relationTo
        if (!target) {
          throw new Error(`${where} is a relationship with no relationTo, so it points at nothing.`)
        }
        if (!resolvedByName.has(target)) {
          throw new Error(`${where} points at kayan "${target}", which is not in the list passed to buildAsas. Add it to that list.`)
        }
      }
    }
    // A mark the client supplies would be a delete performed under the create or update key.
    declaredTargets(`Kayan "${kayan.name}"`, kayan.targets, kayanTargetNames)
    const kept = versioning && (kayan.targets?.[versioning[0]] as KayanVersions | undefined)
    if (kept) kayan.versions = versionsOf({ kayan, kept, name: versioning[0], window: versioning[1].max })
    if (kayan.softDelete) {
      const field = kayan.fields[kayan.softDelete]!
      const where = `Kayan "${kayan.name}" field "${field.name}" is the service target's soft-delete field`
      if (!language.kinds[field.kind]!.accepts(new Date())) {
        throw new Error(
          `${where}, and kind "${field.kind}" does not hold a moment, which is what a delete writes into it.`,
        )
      }
      if (field.rules?.required) {
        throw new Error(
          `${where} and declares "required", and a row that has to carry the moment it was deleted can never be made.`,
        )
      }
      if (field.rules?.localized) {
        throw new Error(
          `${where} and declares "localized", and a mark spread over one column per locale is not one column a read can leave out.`,
        )
      }
      const on = (['create', 'update'] as const).find((one) => providerOf(field, one) === 'client')
      if (on) {
        throw new Error(
          `${where} and the client supplies it on ${on}, so a caller holding "${on}" could delete a row without the delete operation. Declare providedBy { create: "never", update: "never" }.`,
        )
      }
    }
    // The one place every global reaches, through `defineGlobal` or as plain data.
    if (kayan.single) {
      // Nothing injects `globalType`, so a global that did not spread it would fail at the store.
      const { globalType } = kayan.fields
      const owner = kayan.tenant
      const tenant = owner && kayan.fields[owner]
      if (!globalType) {
        throw new Error(
          `Global "${kayan.name}" declares no field "globalType", and every global needs one, because the store seal writes the global's own name into it on every write. Spread defaultGlobalFields into its fields: fields: { ...defaultFields, ...defaultGlobalFields }.`,
        )
      }
      // Postgres allows any number of nulls in a unique column, so the tenant is required too.
      if (tenant && !(tenant.rules?.required === true && tenant.rules.unique === true)) {
        throw new Error(
          `Global "${kayan.name}" declares tenant field "${owner}" without required and unique, and that column is what keeps the global to one row per tenant. Write it as ${owner}: { ...${owner}, rules: { ...${owner}.rules, required: true, unique: true } }.`,
        )
      }
      const oneRow = !!tenant !== (globalType.rules?.unique === true)
      if (!oneRow) {
        throw new Error(
          tenant
            ? `Global "${kayan.name}" declares a tenant and a unique "globalType", so a second tenant's row would collide with the first one's. Write globalType without unique: globalType: { ...defaultGlobalFields.globalType, rules: { required: true } }.`
            : `Global "${kayan.name}" declares no tenant and a "globalType" that is not unique, so two first updates would leave two rows. Spread defaultGlobalFields, whose globalType is unique.`,
        )
      }
      // The index, not the rule alone, is what refuses a second row when two first writes race.
      const keeper = tenant ? owner : 'globalType'
      if (!kayan.indexes.some((index) => index.unique && index.fields.length === 1 && index.fields[0] === keeper)) {
        throw new Error(`Global "${kayan.name}" builds no unique index over "${keeper}" alone, and that index is what keeps the global to one row${tenant ? ' per tenant' : ''}. Keep it in indexes.`)
      }
      // The declaration, not the compiled object: a callback that is not the compiled
      // table's own is one the global wrote.
      const compiledRows = rowsOf(kayan.access) as Record<string, unknown> | undefined
      const declared = kayan.access as Record<string, unknown> | undefined
      for (const operation of ['create', 'delete'] as const) {
        if (declared && operation in declared && declared[operation] !== compiledRows?.[operation]) {
          throw new Error(
            `Global "${kayan.name}" declares access "${operation}", and a global has read and update only, which is Payload's GlobalAccess.`,
          )
        }
      }
      for (const operation of Object.keys(kayan.operations)) {
        if (globalRuns.has(operation)) continue
        throw new Error(
          `Global "${kayan.name}" declares operation "${operation}", and a global runs "findOne" and "update" alone.`,
        )
      }
    }
    for (const [operation, declaration] of Object.entries(kayan.operations)) {
      kayan.operations[operation] = sealed(kayan.name, operation, declaration as unknown as OperationDeclaration, service)
      // A version operation reads and writes the versions table, and a kayan
      // that keeps no versions has none.
      const held = kayan.operations[operation]!.steps.map(sealOf).find((one) => one && versionSeals.includes(one))
      if (held && !kayan.versions) {
        throw new Error(
          `Kayan "${kayan.name}" operation "${operation}" holds the "${held}" step, and the kayan keeps no versions. Write targets.${versioning?.[0] ?? 'versions'} on the kayan, or leave "${operation}" out of the object.`,
        )
      }
    }
    // Refused rather than dropped: a bulk without its single-row write cannot run.
    for (const [operation, declaration] of Object.entries(kayan.operations)) {
      const seal = declaration.steps.map(sealOf).find((held) => held && bulkSeals.includes(held))
      if (!seal) continue
      const single = seal === 'updateMany' ? 'update' : 'delete'
      if (kayan.operations[single]) continue
      throw new Error(
        `Kayan "${kayan.name}" operation "${operation}" writes every matched row through operation "${single}", which this kayan does not have. Declare it, or leave "${operation}" out of the object.`,
      )
    }
  }
  // A language that names the mark and a build where nothing takes it makes every delete
  // remove the row for good, with nothing said.
  const deletes = resolved.some((kayan) =>
    Object.values(kayan.operations).some((operation) => operation.effect === 'delete'))
  if (service.softDelete && deletes && !resolved.some((kayan) => kayan.softDelete)) {
    throw new Error(
      `The service target names "${service.softDelete}" as its soft-delete field, and no kayan in this build declares it, so every delete removes its row for good. Declare the field on the kayan that keep their rows, or drop "softDelete" from the service target.`,
    )
  }
  return resolved
}
