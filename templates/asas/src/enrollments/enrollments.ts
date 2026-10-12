import { defaultFields, defaultOperations, folderOf } from 'mithaq'
import { defineKayan, organization } from '../mithaq.ts'
import { readsPast, user as actor } from '../tenant-access.ts'
import { activity, appPage, danger, platformList, platformRecord, topPage } from '../pages.ts'
import { user } from '../kayan/auth/user/user.ts'
import { sessions } from '../sessions/sessions.ts'

const ui = folderOf(new URL('./ui/', import.meta.url))
const sessionCell = ui('session-cell.tsx#SessionCell')
const enrollment = [{ section: 'enrollment', label: { en: 'Enrollment', ar: 'التسجيل' }, fields: ['session', 'student'] }] as const

/**
 * The seats an actor reads, edits and deletes, inside its active organization:
 * every seat of its organization for an actor holding
 * `enrollments.others` and for platform staff, its own seats alone for anyone
 * else. That is the student, whose enrollment keys would otherwise reach every
 * other student's seat, and a custom role a tenant writes without the key.
 * Another's seat answers 404, as a missing row does.
 *
 * The id is read off the actor as an own key, and an actor carrying none reaches
 * no seat. Every read answers from it, a session's join of its enrollments
 * included.
 */
const ownSeats = ({ user }: { user: unknown }) => {
  if (readsPast(user, 'enrollments.others')) return true
  const actor = user && typeof user === 'object' ? (user as Record<string, unknown>) : undefined
  const id = actor && Object.hasOwn(actor, 'id') ? actor.id : undefined
  return typeof id === 'string' && id ? { student: { equals: id } } : false
}

export const enrollments = defineKayan({
  name: 'enrollments',
  access: { read: ownSeats, update: ownSeats, delete: ownSeats },
  fields: {
    ...defaultFields,
    organization,
    // Read as the session's course and its start on every screen, where a
    // session alone is titled by its start.
    //
    // Both are required, so no write makes a seat for nobody or in nothing, and
    // a session or a person that holds one is not deleted under it: a required
    // relationship restricts.
    session: {
      kind: 'relationship', label: { en: 'Session', ar: 'الحصة' }, relationTo: () => sessions,
      rules: { required: true },
      targets: { dashboard: { cell: sessionCell }, portal: { cell: sessionCell }, platform: { cell: sessionCell } },
    },
    // A create that names no student enrolls the person making it: the runner's
    // defaults step fills it from the actor, and a field with a default is one a
    // create may leave out, at the HTTP boundary too. A role without the column's
    // key is refused the filled value, so today only the instructor's and the
    // administrator's API create fills it; the student reads its own seats and
    // creates none.
    student: {
      kind: 'relationship', label: { en: 'Student', ar: 'الطالب' }, relationTo: () => user,
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
  },
  targets: {
    // Every organization's rows on the platform, read-only, and each row's
    // record, which only reads. A record is titled by its student, a person the
    // platform reads, where a session is titled only by its start.
    platform: {
      useAsTitle: 'student',
      pages: {
        ...platformList('/enrollments', { columns: ['session', 'student', 'organization', 'createdAt'], filters: ['organization', 'session', 'student'], sort: '-createdAt' }),
        ...platformRecord({
          path: '/enrollments/:id',
          main: [{ section: 'enrollment', label: { en: 'Enrollment', ar: 'التسجيل' }, fields: ['session', 'student', 'deletedAt'] }],
        }),
      },
    },
    service: { operations: defaultOperations },
    // Both screens list enrollments; the portal's create opens as a drawer over
    // its list. Titled by the student on the dashboard, as on the platform, so a
    // tab and a heading tell one seat from another; on the portal, where the
    // student is most often the viewer, by the session.
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
        // read-only: when the student enrolled, beside the organization it
        // belongs to, read by its name.
        edit: {
          path: '/enrollments/:id',
          page: appPage([{
            layout: 'record',
            main: [{ form: enrollment }],
            side: [{ section: 'record', label: { en: 'Record', ar: 'السجل' }, fields: [{ field: 'organization', readOnly: true }, { field: 'createdAt', readOnly: true }] }, activity],
            danger: danger(),
          }]),
        },
      },
    },
    portal: {
      useAsTitle: 'session',
      pages: {
        list: { path: '/enrollments', page: topPage([{ layout: 'page', main: [{ list: { columns: ['session', 'createdAt'] } }] }]) },
        // The student too, as the dashboard draws it, so an instructor picks
        // whom it enrolls. A role without `enrollments.fields.student` is not
        // projected the field and is drawn the session alone.
        create: { path: '/enrollments/new', mode: 'drawer', page: topPage([{ layout: 'page', main: [{ form: ['session', 'student'] }] }]) },
        edit: { path: '/enrollments/:id', page: topPage([{ layout: 'page', main: [{ form: ['session'] }] }]) },
      },
    },
  },
})
