import { actorPermissions, count, defaultFields, denied, find, findOne, invalid, type Ctx, type Held } from 'mithaq'
import { defineKayan, rows, organization } from '@asas/mithaq'
import { backofficeClosed } from '@asas/mithaq/roles/tenant-access.ts'
import { auditLogName, type Change } from '@asas/mithaq/mithaq/audit-sink.ts'

/** The kayan whose `find` this actor holds, which are the kayan whose entries it reads. */
const heldKayans = (held: Exclude<Held, true | undefined>) =>
  [...held].filter((key) => key.endsWith('.find') && !key.includes('.fields.')).map((key) => key.slice(0, -'.find'.length))

/**
 * The read the log's rows are ANDed with, so it narrows and never widens: an
 * entry of a kayan the actor may not list is no entry it reads. An actor
 * nothing grades reads none, which is the closed direction.
 */
const readableKayans = ({ user }: { user: unknown }) => {
  const held = actorPermissions(user)
  if (held === true) return true
  const kayans = held ? heldKayans(held) : []
  return kayans.length ? { kayan: { in: kayans } } : false
}

/**
 * Whether this actor reads one column of the kayan an entry names. The access
 * target grades every column of this project by its key.
 */
const readsField = (held: Held, kayan: string, field: string) => held === true || held?.has(`${kayan}.fields.${field}`) === true

/**
 * Whether this actor reads the provider's people, by the key of their `find`.
 * A command's operating-system user is the one thing in the log that names a
 * person no row of the people does, so only such a reader sees or asks for it.
 */
const readsPeople = (held: Held) => held === true || held?.has('user.find') === true

/**
 * What the sink writes for a command: the command, then the operating-system
 * user in parentheses. The command is the shortest part before ` (`, so a user
 * holding a parenthesis is never left in it.
 */
const commandActor = /^(.+?) \(.+\)$/

/**
 * The step after the read: each entry keeps the changes of the columns the
 * actor may read and drops the rest whole, so a column it may not read shows
 * neither value nor that it changed. The server does it rather than the page,
 * because the log is read over HTTP as well as drawn.
 */
const visibleChanges = (ctx: Ctx): Ctx => {
  const held = actorPermissions(ctx.actor)
  const trim = (entry: unknown) => {
    if (!entry || typeof entry !== 'object' || typeof (entry as { changes?: unknown }).changes !== 'string') return entry
    const { kayan, changes } = entry as { kayan: string; changes: string }
    const all = JSON.parse(changes) as Record<string, Change>
    const kept = Object.fromEntries(Object.entries(all).filter(([field]) => readsField(held, kayan, field)))
    // A command's actor is the command alone to a reader of no people, its operating-system user blanked.
    const actor = (entry as { actor?: unknown }).actor
    const named = !readsPeople(held) && typeof actor === 'string' ? { actor: commandActor.exec(actor)?.[1] ?? actor } : {}
    return { ...entry, ...named, changes: JSON.stringify(kept) }
  }
  const data: unknown = ctx.data
  const page = data && typeof data === 'object' && Array.isArray((data as { docs?: unknown }).docs) ? (data as { docs: unknown[] }) : undefined
  return { ...ctx, data: (page ? { ...page, docs: page.docs.map(trim) } : trim(data)) as Record<string, unknown> }
}

/**
 * The columns the log is filtered and ordered by. The organization is core's
 * own filter and `impersonatedBy` names staff.
 */
const queryable = new Set(['kayan', 'record', 'createdAt', 'operation', 'actor'])

/**
 * What a change is searched by besides those, never ordered by: its text,
 * `changes`, and the names of the columns it changed, `changed`. Each takes one
 * `contains` alone and reaches only the kayan whose columns it may tell of
 * (`reachOf`), because a match in a column the reader holds no key for would say
 * what that column held before `visibleChanges` trims the page.
 */
const searched = new Set(['changes', 'changed'])

/** One column's name between the spaces `changed` holds each in, which is all a search of it may ask. */
// ponytail: `contains` is the store's ILIKE, so ` title ` also finds a kayan's ` Title `; harmless
// while no kayan holds two columns differing in case alone, which none does. A case-sensitive
// operator in the where language is the upgrade.
const oneColumn = /^ ([A-Za-z_][A-Za-z0-9_]*) $/

const namedIn = (where: unknown): string[] => {
  if (!where || typeof where !== 'object') return []
  return Object.entries(where).flatMap(([key, value]) =>
    (key === 'and' || key === 'or') && Array.isArray(value) ? value.flatMap(namedIn) : [key])
}

/** Every column key the catalog holds, by the kayan it belongs to. */
const columnsOf = (catalog: readonly string[]) => {
  const columns = new Map<string, string[]>()
  for (const key of catalog) {
    const at = key.indexOf('.fields.')
    if (at > 0) columns.set(key.slice(0, at), [...(columns.get(key.slice(0, at)) ?? []), key])
  }
  return columns
}

// ponytail: the reach here and `visibleChanges` grade by keys alone. A tenant role that a row
// table narrows further, by a `fields` list or a row filter on its read, would be told of columns
// and rows its own reads hide; grade each entry through the kayan's own field access and read
// `where` before a project adds one.
/**
 * The kayan one search of a change reaches for this actor, or `true` for every
 * one. The text reaches a kayan whose every column the actor reads; a column's
 * name reaches a kayan whose column of that name it reads, since `changed` holds
 * names alone. Anything but one `contains`, and a `changed` naming anything but
 * one column, is refused.
 */
const reachOf = ({ held, catalog }: { held: Held; catalog: readonly string[] }) => (column: string, rules: unknown): true | string[] => {
  const asked = rules && typeof rules === 'object' ? Object.entries(rules) : []
  const [operator, value] = asked[0] ?? []
  const name = column === 'changed' && typeof value === 'string' ? oneColumn.exec(value)?.[1] : undefined
  if (asked.length !== 1 || operator !== 'contains' || typeof value !== 'string' || (column === 'changed' && name === undefined)) {
    throw invalid({ message: `Kayan "auditLog" is searched by "${column}" with one "contains" alone${column === 'changed' ? ', of one column\'s name between two spaces' : ''}.`, key: 'error.invalid.where', params: { kayan: 'auditLog', field: column } })
  }
  if (held === true) return true
  return [...columnsOf(catalog)]
    .filter(([kayan, keys]) => held?.has(`${kayan}.find`) && (name === undefined ? keys.every((key) => held.has(key)) : held.has(`${kayan}.fields.${name}`)))
    .map(([kayan]) => kayan)
}

/**
 * The `where` with each search of a change ANDed, where it stands, with the kayan
 * it reaches, so an `or` around it still means what it said.
 */
const narrowed = (where: unknown, reach: (column: string, rules: unknown) => true | string[]): unknown => {
  if (!where || typeof where !== 'object') return where
  const parts = Object.entries(where).map(([key, value]) => {
    if ((key === 'and' || key === 'or') && Array.isArray(value)) return { [key]: value.map((one) => narrowed(one, reach)) }
    if (!searched.has(key)) return { [key]: value }
    const kayans = reach(key, value)
    return kayans === true ? { [key]: value } : { and: [{ [key]: value }, { kayan: { in: kayans } }] }
  })
  return parts.length === 1 ? parts[0] : { and: parts }
}

/**
 * The step before the read: a `where` naming any column but those above, or a
 * `sort` by any but the queryable ones, is refused 400 before the store is
 * asked, on every read the log declares, and each search of a change is narrowed
 * to the kayan it reaches. The runner's own checks still run after it on what it
 * lets through.
 */
const queriedByQueryable = (ctx: Ctx, tools: { catalog: readonly string[] }): Ctx => {
  // The runner names the organization a read is scoped to only where the read is not widened.
  // `reachOf` and `visibleChanges` grade by the active organization's keys, so a read across every
  // membership (`tenant: 'mine'`) would grade another organization's entries by this one's: it is
  // refused before anything else of it is judged.
  if (ctx.tenant === undefined) {
    throw denied({ message: 'Kayan "auditLog" is read in the active organization alone.', key: 'error.forbidden.read', params: {} })
  }
  const { where, sort } = ctx.data as { where?: unknown; sort?: unknown }
  const field = namedIn(where).find((name) => !queryable.has(name) && !searched.has(name))
  if (field !== undefined) {
    throw invalid({ message: `Kayan "auditLog" is filtered by ${[...queryable, ...searched].join(', ')} alone, and not by "${field}".`, key: 'error.invalid.where', params: { kayan: 'auditLog', field } })
  }
  const held = actorPermissions(ctx.actor)
  // A reader of no people names an actor in no filter and no sort: a pattern, a range, an order or
  // even an equality over the string would let it confirm a guessed operating-system user of a
  // command's actor.
  if (!readsPeople(held) && (namedIn(where).includes('actor') || (typeof sort === 'string' && sort.replace(/^-/, '') === 'actor'))) {
    throw invalid({ message: 'Kayan "auditLog" is neither filtered nor sorted by "actor" for a reader of no people.', key: 'error.invalid.where', params: { kayan: 'auditLog', field: 'actor' } })
  }
  if (sort !== undefined && !(typeof sort === 'string' && queryable.has(sort.replace(/^-/, '')))) {
    throw invalid({ message: `Kayan "auditLog" is sorted by ${[...queryable].join(', ')} alone.`, key: 'error.invalid.sort_field', params: { kayan: 'auditLog', field: String(sort) } })
  }
  return where === undefined ? ctx : { ...ctx, data: { ...ctx.data, where: narrowed(where, reachOf({ held, catalog: tools.catalog })) } }
}

/**
 * The audit log's rows: an organization reads its own entries, and nothing writes
 * one through the log, a caller of any role included, since the service
 * target's sink writes each entry through the store inside the write it
 * records. Every backoffice role is closed: the backoffice lists no entry, and a
 * staff member's own impersonated writes are the entries it would read.
 */
const auditLogAccess = rows({
  '*': { create: false, read: true, update: false, delete: false },
  ...backofficeClosed,
})

/**
 * The audit log: one row per row a write changed, written by the service
 * target's audit sink inside that write's own transaction and by nothing else.
 * It declares no operation that writes, so no caller creates, edits or deletes
 * an entry, and each of its rows answers `false` for every write besides.
 *
 * It is its organization's own. A record's last entries are read in its edit
 * page's side column, all of them in its Activity tab, and the organization's on
 * the dashboard's Activity page, a page of the screen's own rather than of this
 * kayan, which draws none. The backoffice lists none of it and reads none of
 * it: staff's own actions are its staff history, `backofficeLog`.
 */
export const auditLog = defineKayan({
  name: auditLogName,
  dbName: 'audit_log',
  messages: {
    singular: { en: 'Audit entry', ar: 'سجل تدقيق' },
    plural: { en: 'Audit log', ar: 'سجل التدقيق' },
    // What the activity panel draws beside the field labels.
    activity: { en: 'Activity', ar: 'النشاط' },
    loading: { en: 'Loading activity…', ar: 'جارٍ تحميل النشاط…' },
    empty: { en: 'Nothing has changed here yet.', ar: 'لم يتغير شيء هنا بعد.' },
    failed: { en: 'The activity could not be read.', ar: 'تعذرت قراءة النشاط.' },
    more: { en: 'Show older', ar: 'عرض الأقدم' },
    system: { en: 'The system', ar: 'النظام' },
    event: { en: '{action} by {actor}', ar: '{action} بواسطة {actor}' },
    // Staff writing as a member: the real person first, as the member they wrote as.
    impersonated: { en: '{staff} as {member}', ar: '{staff} بصفة {member}' },
    // One per operation a tenant kayan writes through, which is every entry the sink records.
    action: {
      create: { en: 'Created', ar: 'أُنشئ' },
      update: { en: 'Updated', ar: 'حُدِّث' },
      delete: { en: 'Deleted', ar: 'حُذف' },
      updateMany: { en: 'Updated', ar: 'حُدِّث' },
      deleteMany: { en: 'Deleted', ar: 'حُذف' },
      restoreVersion: { en: 'Restored a version', ar: 'استُعيد إصدار' },
      archive: { en: 'Archived', ar: 'أُرشف' },
      archiveMany: { en: 'Archived', ar: 'أُرشف' },
      unarchive: { en: 'Unarchived', ar: 'أُلغيت أرشفته' },
      unpublish: { en: 'Unpublished', ar: 'أُلغي نشره' },
      // An update that published a draft, which the sink names apart from a plain update.
      publish: { en: 'Published', ar: 'نُشر' },
    },
    someone: { en: 'Someone', ar: 'شخص ما' },
    // A command line write, named for a reader of the people: the command and
    // the operating-system user who ran it.
    command: { en: 'the command {command} ({user})', ar: 'الأمر {command} ({user})' },
    // The viewer's own entry, which needs no read of the people to name. Its
    // sentence is its own, since Arabic joins the person to "by" in one word,
    // "بواسطتك", and not as "بواسطة أنت".
    you: { en: 'You', ar: 'أنت' },
    eventYou: { en: '{action} by You', ar: '{action} بواسطتك' },
    none: { en: 'No field you may read changed.', ar: 'لم يتغير حقل يمكنك قراءته.' },
    // Beside a change the sink cut to the start of its JSON, which a large json value is.
    truncated: { en: 'Too long to keep whole; its start is shown.', ar: 'أطول من أن يُحفظ كاملا؛ تظهر بدايته.' },
    // The panel's link to the rest of a record's entries, and the Activity page and tab.
    all: { en: 'All activity', ar: 'كل النشاط' },
    about: { en: 'Every change in this organization, newest first.', ar: 'كل تغيير في هذه المؤسسة، الأحدث أولا.' },
    filters: { en: 'Filter the activity', ar: 'تصفية النشاط' },
    // What the search box names as what it searches, in the sentence "Search changed values".
    searchChanges: { en: 'changed values', ar: 'القيم المتغيرة' },
    person: { en: 'Person', ar: 'الشخص' },
    type: { en: 'Record type', ar: 'نوع السجل' },
    field: { en: 'Field', ar: 'الحقل' },
    actionFilter: { en: 'Action', ar: 'الإجراء' },
    from: { en: 'From', ar: 'من' },
    to: { en: 'To', ar: 'إلى' },
    any: { en: 'Any', ar: 'الكل' },
    filter: {
      created: { en: 'Created', ar: 'أُنشئ' },
      updated: { en: 'Updated', ar: 'حُدِّث' },
      deleted: { en: 'Deleted', ar: 'حُذف' },
      published: { en: 'Published', ar: 'نُشر' },
      restored: { en: 'Restored', ar: 'استُعيد' },
    },
    clear: { en: 'Clear filters', ar: 'مسح عوامل التصفية' },
    nothing: { en: 'No activity matches these filters.', ar: 'لا نشاط يطابق عوامل التصفية هذه.' },
    oneRecord: { en: 'One record\'s activity.', ar: 'نشاط سجل واحد.' },
    found: { en: 'Entries found: {count}', ar: 'السجلات المطابقة: {count}' },
    searchLimited: { en: 'The search covers the records whose every field you may read.', ar: 'يشمل البحث السجلات التي يمكنك قراءة كل حقولها.' },
  },
  access: { ...auditLogAccess, read: readableKayans },
  targets: {
    dashboard: {},
    service: {
      operations: {
        find: { steps: [queriedByQueryable, find, visibleChanges] },
        findByID: { steps: [queriedByQueryable, findOne, visibleChanges] },
        count: { steps: [queriedByQueryable, count] },
      },
    },
  },
  fields: {
    id: defaultFields.id,
    createdAt: defaultFields.createdAt,
    organization,
    kayan: { kind: 'text', label: { en: 'Kayan', ar: 'الكيان' }, rules: { required: true, maxLength: 60 } },
    record: { kind: 'text', label: { en: 'Record', ar: 'السجل' }, rules: { required: true, index: true } },
    operation: { kind: 'text', label: { en: 'Operation', ar: 'العملية' }, rules: { required: true, maxLength: 60 } },
    actor: { kind: 'text', label: { en: 'Actor', ar: 'المنفذ' } },
    impersonatedBy: { kind: 'text', label: { en: 'Impersonated by', ar: 'انتحل الصفة' } },
    // Never an order, and searched by `queriedByQueryable`'s rules alone.
    changes: { kind: 'text', label: { en: 'Changes', ar: 'التغييرات' }, rules: { required: true }, targets: { dashboard: { sortable: false } } },
    // The names of the columns `changes` holds, each between two spaces, so the
    // Activity's column filter finds a change of one column without searching a
    // value. Empty on an entry written before it was.
    changed: { kind: 'text', label: { en: 'Changed columns', ar: 'الحقول المتغيرة' }, targets: { dashboard: { sortable: false } } },
  },
})
