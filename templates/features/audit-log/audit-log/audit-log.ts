import { actorPermissions, count, defaultFields, find, findOne, invalid, type Ctx, type Held } from 'mithaq'
import { defineKayan, rows, organization } from '@asas/mithaq'
import { platformClosed } from '@asas/mithaq/roles/tenant-access.ts'
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
 * The columns the log is read by. Nothing else filters or orders it, `changes`
 * above all: a `contains` over its text would read a value out of a column the
 * reader holds no key for, before `visibleChanges` trims the page. The
 * organization is core's own filter and `impersonatedBy` names staff.
 */
const queryable = new Set(['kayan', 'record', 'createdAt', 'operation', 'actor'])

const namedIn = (where: unknown): string[] => {
  if (!where || typeof where !== 'object') return []
  return Object.entries(where).flatMap(([key, value]) =>
    (key === 'and' || key === 'or') && Array.isArray(value) ? value.flatMap(namedIn) : [key])
}

/**
 * The step before the read: a `where` or a `sort` naming any column but those
 * is refused 400, before the store is asked, on every read the log declares.
 * The runner's own checks still run after it on what it lets through.
 */
const queriedByQueryable = (ctx: Ctx): Ctx => {
  const { where, sort } = ctx.data as { where?: unknown; sort?: unknown }
  const field = namedIn(where).find((name) => !queryable.has(name))
  if (field !== undefined) {
    throw invalid({ message: `Kayan "auditLog" is filtered by ${[...queryable].join(', ')} alone, and not by "${field}".`, key: 'error.invalid.where', params: { kayan: 'auditLog', field } })
  }
  // A reader of no people names an actor in no filter and no sort: a pattern, a range, an order or
  // even an equality over the string would let it confirm a guessed operating-system user of a
  // command's actor.
  if (!readsPeople(actorPermissions(ctx.actor)) && (namedIn(where).includes('actor') || (typeof sort === 'string' && sort.replace(/^-/, '') === 'actor'))) {
    throw invalid({ message: 'Kayan "auditLog" is neither filtered nor sorted by "actor" for a reader of no people.', key: 'error.invalid.where', params: { kayan: 'auditLog', field: 'actor' } })
  }
  if (sort !== undefined && !(typeof sort === 'string' && queryable.has(sort.replace(/^-/, '')))) {
    throw invalid({ message: `Kayan "auditLog" is sorted by ${[...queryable].join(', ')} alone.`, key: 'error.invalid.sort_field', params: { kayan: 'auditLog', field: String(sort) } })
  }
  return ctx
}

/**
 * The audit log's rows: an organization reads its own entries, and nothing writes
 * one through the log, a caller of any role included, since the service
 * target's sink writes each entry through the store inside the write it
 * records. Every platform role is closed: the platform lists no entry, and a
 * staff member's own impersonated writes are the entries it would read.
 */
const auditLogAccess = rows({
  '*': { create: false, read: true, update: false, delete: false },
  ...platformClosed,
})

/**
 * The audit log: one row per row a write changed, written by the service
 * target's audit sink inside that write's own transaction and by nothing else.
 * It declares no operation that writes, so no caller creates, edits or deletes
 * an entry, and each of its rows answers `false` for every write besides.
 *
 * It is its organization's own, and a record's entries are read on that record's edit
 * page. The dashboard lists it for its access report alone, which is what the
 * edit pages' panel is drawn by, and draws no page of it. The platform lists
 * none of it and reads none of it.
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
    // Never an order, which the runner refuses by name for every read, and never
    // a filter or a search, which the dashboard offers only where a field opts in.
    changes: { kind: 'text', label: { en: 'Changes', ar: 'التغييرات' }, rules: { required: true }, targets: { dashboard: { sortable: false } } },
  },
})
