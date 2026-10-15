import { conflict, defaultOperations, folderOf, invalid, type Ctx, type FilterOptions, type WriteTools } from 'mithaq'
import { defineKayan, organization, serverTargets } from '@asas/mithaq'
import { currentOrganization, readsPast, user as actor } from '@asas/mithaq/roles/tenant-access.ts'
import { activity, appPage, danger, backofficeList, backofficeRecord } from '@asas/mithaq/mithaq/pages.ts'
import { sessions } from '../sessions/sessions.ts'
import { holdSeats, seatsTaken, sessionHeld } from '../sessions/seats.ts'
// add-on: settings
import { sql } from 'mithaq/drizzle'
import type { NodePgDatabase } from 'mithaq/drizzle/node-postgres'
// end add-on: settings

const ui = folderOf(new URL('./ui/', import.meta.url))
const portalUi = folderOf(new URL('../portal/ui/', import.meta.url))
/** A portal page in its shell, which draws the portal's own nav, over its single column. */
const portalPage = <const Main extends readonly unknown[]>(main: Main) => ({ shell: 'top', header: [{ title: {} }], main: [{ layout: 'page', main }] }) as const
const sessionCell = ui('session-cell.tsx#SessionCell')
const enrollment = [{ section: 'enrollment', label: { en: 'Enrollment', ar: 'التسجيل' }, fields: ['session', 'student'] }] as const

/**
 * The seats an actor reads, edits and deletes, inside its active organization:
 * every seat of its organization for an actor holding
 * `enrollments.others` and for backoffice staff, its own seats alone for anyone
 * else. That is the student, whose enrollment keys would otherwise reach every
 * other student's seat, and a custom role a tenant writes without the key.
 * Another's seat answers 404, as a missing row does.
 *
 * The id is read off the actor as an own key, and an actor carrying none reaches
 * no seat. Every read answers from it, a session's join of its enrollments
 * included.
 */
const ownId = (user: unknown) => {
  const actor = user && typeof user === 'object' ? (user as Record<string, unknown>) : undefined
  const id = actor && Object.hasOwn(actor, 'id') ? actor.id : undefined
  return typeof id === 'string' && id ? id : undefined
}
const ownSeats = ({ user }: { user: unknown }) => {
  if (readsPast(user, 'enrollments.others')) return true
  const id = ownId(user)
  return id ? { student: { equals: id } } : false
}

/**
 * Whether a write names another person as a seat's student for an actor that
 * writes its own seats alone. Refused on a create and on an update, so a seat
 * is never made for, or handed to, someone the actor may not write for.
 */
const namesAnother = ({ user, data }: { user: unknown; data?: unknown }) =>
  !readsPast(user, 'enrollments.others') && !!data && typeof data === 'object' && Object.hasOwn(data, 'student')
  && (data as { student?: unknown }).student !== ownId(user)

/**
 * Whom a seat's student picker offers: the people holding the student role in
 * the active organization, a teacher who also studies among them. It narrows
 * what the actor's own read of people answers and never widens it, so an
 * instructor is offered the students it already reads and not itself.
 */
const students: FilterOptions = async ({ user, tx }) => {
  const active = currentOrganization(user)
  if (!active) return false
  const held = await serverTargets.drizzle.find({ tx, kayan: 'memberRoles', args: { limit: 0, page: 1, sort: { field: 'id', direction: 'asc' }, where: { organization: { equals: active }, role: { equals: 'student' } } } })
  const ids = held.docs.map((row) => row.user).filter((id): id is string => typeof id === 'string')
  return ids.length ? { id: { in: ids } } : false
}

/** Not archived, the column read by its name, or across a session's course. */
const open = (path: string) => ({ or: [{ [path]: { exists: false } }, { [path]: { equals: false } }] })

/** What a seat's session picker offers, and a save is held to: a session open for seats, of a course open too. */
const openSessions: FilterOptions = () => ({ and: [open('archived'), open('course.archived')] })

/** Whether the actor writes its own seats alone: a student, held to what each course lets its students do. */
const ownSeatsOnly = (user: unknown) => !readsPast(user, 'enrollments.others')

/** Whether a session is still to start, which a student's enrollment and its cancel both ask. */
const yetToStart = (startsAt: unknown) => new Date(startsAt as string | Date).getTime() > Date.now()

/**
 * Whether a session takes this seat. A session the actor may not read is left
 * to the reference check, which refuses it in the words a missing one gets.
 * The rest is judged on the session's own columns, whatever the actor is shown:
 * an archived session, or one of an archived course, takes none; a student
 * takes a seat only where its course lets students enroll themselves, and only
 * before the session starts; and a session with a capacity takes no seat past
 * it, whoever writes, counted under a lock on the session. A seat kept in the
 * session it already holds takes no new one.
 */
const takesSeat = async (ctx: Ctx<{ session?: unknown }>, tools: WriteTools): Promise<Ctx> => {
  const id = ctx.data.session
  // An edit of a seat the actor may not reach loaded no row; the store answers it the 404 a missing one gets.
  if (typeof id !== 'string' || (tools.operation !== 'create' && !ctx.dataBefore)) return ctx
  if (!(await tools.of(sessions).findByID({ id }).catch(() => null))) return ctx
  const session = await sessionHeld({ tx: ctx.tx, session: id })
  if (!session) return ctx
  // The stored id from here on: a uuid matches in any case, and the lock, the count and the comparison below must not
  // tell `A0EE…` from `a0ee…`.
  const held = session.id
  if (session.archived || session.courseArchived) {
    throw invalid({
      message: 'This session is archived, or its course is, so it takes no new seat.',
      key: 'error.invalid.archived_session',
      params: { kayan: 'enrollments', field: 'session' },
    })
  }
  if (held === ctx.dataBefore?.session) return ctx
  if (ownSeatsOnly(ctx.user)) {
    if (session.selfEnroll !== true) {
      throw invalid({
        message: 'Students of this course do not enroll themselves: the school enrolls them.',
        key: 'error.invalid.enrollment_closed',
        params: { kayan: 'enrollments', field: 'session' },
      })
    }
    if (!yetToStart(session.startsAt)) {
      throw invalid({ message: 'This session has started, so it takes no new seat.', key: 'error.invalid.session_started', params: { kayan: 'enrollments', field: 'session' } })
    }
  }
  if (session.capacity !== null) {
    await holdSeats({ tx: ctx.tx, session: held })
    if ((await seatsTaken({ session: held, tx: ctx.tx })) >= session.capacity) {
      throw conflict({ message: 'Every seat of this session is taken.', key: 'error.conflict.session_full', params: { kayan: 'enrollments', field: 'session' } })
    }
  }
  return ctx
}

/**
 * A student leaves a session only before it starts: the seat it held stays the
 * record that it was there. Whoever reads every seat withdraws one at any time.
 * A seat the actor may not reach loaded no row, and answers the 404 a missing
 * one does. The start is the session's column, so a seat whose course has since
 * left the actor's sight is not said to have started.
 */
const leavesBeforeStart = async (ctx: Ctx): Promise<Ctx> => {
  if (!ownSeatsOnly(ctx.user) || !ctx.dataBefore) return ctx
  const id = ctx.dataBefore.session
  const session = typeof id === 'string' ? await sessionHeld({ tx: ctx.tx, session: id }) : undefined
  if (!session || !yetToStart(session.startsAt)) {
    throw invalid({ message: 'This session has started, so its seat stays.', key: 'error.invalid.session_started', params: { kayan: 'enrollments' } })
  }
  return ctx
}

// add-on: settings
/**
 * While the portal is closed for maintenance a student takes and gives back no
 * seat, whatever calls the server; staff keep working. The organization's
 * settings are read in the write's own transaction, since a student reads them
 * as itself and a role might not.
 */
// The table and column are written out, as `sessionHeld`'s are; R7g fails on a rename.
const portalOpen = async (ctx: Ctx): Promise<Ctx> => {
  if (!ownSeatsOnly(ctx.user) || !ctx.tenant) return ctx
  const [held] = (await (ctx.tx as NodePgDatabase).execute<{ maintenance: boolean | null }>(sql`select maintenance from settings where organization_id = ${ctx.tenant}`)).rows
  if (held?.maintenance === true) {
    throw invalid({ message: 'The portal is closed for maintenance, so no seat changes from it.', key: 'error.invalid.portal_closed', params: { kayan: 'enrollments' } })
  }
  return ctx
}
// end add-on: settings

export const enrollments = defineKayan({
  name: 'enrollments',
  access: {
    read: ownSeats,
    create: (args: { user: unknown; data?: unknown }) => !namesAnother(args),
    update: (args: { user: unknown; data?: unknown }) => (namesAnother(args) ? false : ownSeats(args)),
    delete: ownSeats,
  },
  // What a form says where a second seat of one student in one session is
  // refused, over the shared words for a unique value taken.
  messages: {
    conflict: { unique: { en: 'This student already holds a seat in this session.', ar: 'لهذا الطالب مقعد في هذه الحصة بالفعل.' } },
  },
  // A student holds one seat in a session, which is one organization's, so the
  // organization needs no column in the key. The mark is in it with its nulls
  // not distinct, so a withdrawn seat makes room for a new one while two
  // standing seats collide.
  indexes: [{ fields: ['session', 'student', 'deletedAt'], unique: true, nullsNotDistinct: true }],
  fields: ({ defaults }) => ({
    ...defaults,
    organization,
    // Read as the session's course and its start on every screen, where a
    // session alone is titled by its start.
    //
    // Both are required, so no write makes a seat for nobody or in nothing, and
    // a session or a person that holds one is not deleted under it: a required
    // relationship restricts.
    session: {
      kind: 'relationship', label: { en: 'Session', ar: 'الحصة' }, relationTo: () => sessions,
      filterOptions: openSessions,
      rules: { required: true },
      targets: { dashboard: { cell: sessionCell }, portal: { cell: sessionCell }, backoffice: { cell: sessionCell } },
    },
    // A create that names no student enrolls the person making it: the runner's
    // defaults step fills it from the actor, and a field with a default is one a
    // create may leave out, at the HTTP boundary too. A role without the column's
    // key is refused the filled value. A student holds it, so its own enrollment
    // names itself, and `namesAnother` refuses it any other person.
    student: {
      kind: 'relationship', label: { en: 'Student', ar: 'الطالب' }, relationTo: 'user',
      filterOptions: students,
      rules: { required: true, defaultValue: actor.id },
    },
    /**
     * The field the language names as its soft-delete mark, so a student who
     * leaves a session is a row this kayan keeps rather than one it removes: an
     * enrollment is the record that the student was there. It is the one kayan
     * of this template that takes the mark. Nothing points at an enrollment, so
     * no child outlives it, and nothing refers to it through a `restrict`
     * foreign key that a delete would have to release. Nobody supplies the
     * mark: the runner writes it at the delete.
     *
     * `session` and `student` are required, so each restricts, and a session or
     * a person a marked enrollment still names is not deleted under it.
     */
    deletedAt: {
      kind: 'datetime',
      label: { en: 'Deleted at', ar: 'تاريخ الحذف' },
      rules: { providedBy: { create: 'never', update: 'never' } },
    },
  }),
  targets: {
    // Every organization's rows on the backoffice, read-only, and each row's
    // record, which only reads. A record is titled by its student, a person the
    // backoffice reads, where a session is titled only by its start.
    backoffice: {
      useAsTitle: 'student',
      pages: {
        ...backofficeList('/enrollments', { columns: ['session', 'student', 'organization', 'createdAt'], filters: ['organization', 'session', 'student'], sort: '-createdAt' }),
        ...backofficeRecord({
          path: '/enrollments/:id',
          main: [{ section: 'enrollment', label: { en: 'Enrollment', ar: 'التسجيل' }, fields: ['session', 'student', 'deletedAt'] }],
        }),
      },
    },
    service: {
      operations: {
        ...defaultOperations,
        create: { ...defaultOperations.create, steps: ({ steps }) => [
          // add-on: settings
          portalOpen,
          // end add-on: settings
          takesSeat,
          steps.insert,
        ] },
        update: { ...defaultOperations.update, steps: ({ steps }) => [
          // add-on: settings
          portalOpen,
          // end add-on: settings
          takesSeat,
          steps.update,
        ] },
        delete: { ...defaultOperations.delete, steps: ({ steps }) => [
          // add-on: settings
          portalOpen,
          // end add-on: settings
          leavesBeforeStart,
          steps.remove,
        ] },
      },
    },
    // Titled by the student on the dashboard, as on the backoffice, so a tab and a
    // heading tell one seat from another; on the portal, where the student is most
    // often the viewer, by the session.
    dashboard: {
      useAsTitle: 'student',
      description: {
        en: 'Which student holds a seat in which session.',
        ar: 'أي طالب يشغل مقعدا في أي حصة.',
      },
      pages: {
        // The same table every kayan's list is. Searched by the student's name,
        // the one column of a person a tenant reads, and filtered by session,
        // student and when the student enrolled, as the course list is.
        list: { path: '/enrollments', page: appPage([{ layout: 'table', main: [{ list: {
          columns: ['session', 'student', 'createdAt'],
          filters: ['session', 'student', 'createdAt'],
          search: ['student.name'],
        } }] }]) },
        create: { path: '/enrollments/new', page: appPage([{ layout: 'record', main: [{ form: enrollment }] }]) },
        // The editor layout, and the one timestamp worth reading here, named and
        // read-only: when the student enrolled. Not the organization, which on the
        // dashboard is always the active one.
        edit: {
          path: '/enrollments/:id',
          page: appPage([{
            layout: 'record',
            main: [{ form: enrollment }],
            side: [{ section: 'record', label: { en: 'Record', ar: 'السجل' }, fields: [{ field: 'createdAt', readOnly: true }] }, activity],
            danger: danger(),
          }]),
        },
      },
    },
    portal: {
      useAsTitle: 'session',
      pages: {
        // The viewer's seats, upcoming first, drawn whole by the courses feature's portal.
        list: { path: '/enrollments', component: portalUi('enrollments.tsx#Enrollments') },
        // The list's New enrollment, which only staff are offered, with the
        // student as the dashboard draws it, so an instructor picks whom it
        // enrolls. A student who opens it by its address and names another is
        // refused by `namesAnother`; one who names nobody enrolls itself.
        create: { path: '/enrollments/new', page: portalPage([{ form: ['session', 'student'] }]) },
        edit: { path: '/enrollments/:id', page: portalPage([{ form: ['session'] }]) },
      },
    },
  },
})
