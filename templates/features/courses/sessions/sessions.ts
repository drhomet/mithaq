import { defaultFields, defaultOperations, type Ctx, type Where } from 'mithaq'
import { defineKayan, organization } from '@asas/mithaq'
import { activity, appPage, danger, platformList, platformRecord } from '@asas/mithaq/mithaq/pages.ts'
import { courses, runsCatalogue } from '../courses/courses.ts'
import { archivedRow, marks, reason, reasonInput, unarchived } from '../domain/archive.ts'

/**
 * Writes every matched session `archived: true` and nothing else, whatever the call sent as `data`,
 * so the course page's bulk Archive can only archive, never un-archive.
 */
const archiveAll = (ctx: Ctx): Ctx => ({ ...ctx, data: { ...ctx.data, data: { archived: true, archiveReason: null } } })

/**
 * What a session's create and edit pages both draw, written once so the two cannot drift. The edit
 * page keeps the course on the side; the create page puts it first in the form, because it is
 * required and a side column sits after Save.
 */
const details = [
  { section: 'schedule', label: { en: 'Schedule', ar: 'الموعد' }, fields: [{ row: ['startsAt', 'capacity'] }] },
  { section: 'place', label: { en: 'Venue and format', ar: 'المكان والصيغة' }, fields: [{ row: ['venue', 'format'] }] },
  { section: 'notes', label: { en: 'Notes', ar: 'ملاحظات' }, fields: ['details'] },
] as const
const course = { section: 'course', label: { en: 'Course', ar: 'الدورة' }, fields: ['course'] } as const

/**
 * A session an actor reads, inside its active organization: one whose course that
 * actor reads. Whoever runs the catalogue reads every session; a student or an instructor reads a
 * session only when its course is published and not archived, and never the date of one it may not
 * open.
 */
const ofReadableCourses = ({ user }: { user: unknown }): true | Where =>
  runsCatalogue(user)
    ? true
    : { and: [{ 'course._status': { equals: 'published' } }, { or: [{ 'course.archived': { exists: false } }, { 'course.archived': { equals: false } }] }] }

export const sessions = defineKayan({
  name: 'sessions',
  // ANDed with the inherited rows, so it narrows and never widens.
  access: { read: ofReadableCourses },
  // Better Auth owns a table named `session`, and `session` beside `sessions` in
  // one schema is a trap.
  dbName: 'course_sessions',
  targets: {
    platform: {
      useAsTitle: 'startsAt',
      pages: {
        ...platformList('/sessions', { columns: ['startsAt', 'organization', 'course', 'capacity', 'venue'], filters: ['organization', 'course', 'venue', 'archived'], search: ['venue', 'course.title'], sort: '-startsAt' }),
        ...platformRecord({
          path: '/sessions/:id',
          main: [{ tabs: [
            { tab: 'details', label: { en: 'Details', ar: 'التفاصيل' }, fields: [
              { section: 'schedule', label: { en: 'Schedule', ar: 'الموعد' }, fields: [{ row: ['startsAt', 'capacity'] }] },
              { section: 'place', label: { en: 'Venue and format', ar: 'المكان والصيغة' }, fields: [{ row: ['venue', 'format'] }] },
              { section: 'notes', label: { en: 'Notes', ar: 'ملاحظات' }, fields: ['details'] },
            ] },
            { tab: 'enrollments', label: { en: 'Enrollments', ar: 'التسجيلات' }, fields: [{ list: { of: 'enrollments', where: 'session', columns: ['student', 'createdAt'] } }] },
          ] }],
          side: [{ section: 'course', label: { en: 'Course', ar: 'الدورة' }, fields: ['course', 'archived'] }],
        }),
      },
    },
    // The portal lists sessions for this alone: an enrollment's session reads by its start there as it
    // does on the dashboard.
    portal: { useAsTitle: 'startsAt' },
    dashboard: {
      // What a session is shown by wherever it stands for itself: the picker on `enrollments.session`
      // and a relationship column pointing here. A session declares no name, and its start tells two
      // sessions of one course apart, drawn in the viewer's own format. The search boxes come to
      // nothing, because `like` takes text and email.
      useAsTitle: 'startsAt',
      description: {
        en: 'The dates each course meets, and how many seats each one holds.',
        ar: 'مواعيد انعقاد كل دورة، وعدد المقاعد في كل منها.',
      },
      pages: {
        list: { path: '/sessions', page: appPage([{ layout: 'table', main: [{ list: {
          columns: ['course', 'startsAt', 'capacity', 'venue'],
          filters: ['course', 'startsAt', 'venue', 'format', 'archived'],
          search: ['course.title', 'details'],
        } }] }]) },
        create: {
          path: '/sessions/new',
          page: appPage([{ layout: 'record', main: [{ form: [course, ...details] }] }]),
        },
        edit: {
          path: '/sessions/:id',
          page: appPage([{
            layout: 'record',
            main: [{ tabs: [
              { tab: 'details', label: { en: 'Details', ar: 'التفاصيل' }, fields: [{ form: details }] },
              // Drawn only for an actor the report lets read them: a tab whose only node is hidden is not
              // drawn, so a registrar is not shown a tab with nothing in it.
              { tab: 'enrollments', label: { en: 'Enrollments', ar: 'التسجيلات' }, fields: [{ list: {
                of: 'enrollments',
                where: 'session',
                columns: ['student', 'createdAt'],
              }, when: { '$user.collections.enrollments.operations.find': { equals: true } } }] },
            ] }],
            // Whether it is archived and why, read only: a session is archived through its own operations.
            side: [{ ...course, fields: [...course.fields, { field: 'archived', readOnly: true }, { field: 'archiveReason', readOnly: true }] }, activity],
            // Archived and brought back as a course is, each with its reason, before the delete.
            danger: danger({
              button: 'archive',
              when: unarchived,
              label: { en: 'Archive', ar: 'أرشفة' },
              fields: ['reason'],
              reload: true,
              confirm: { title: { en: 'Archive this session?', ar: 'أرشفة هذه الجلسة؟' }, body: { en: 'It stays on the course, marked archived.', ar: 'تبقى في الدورة، معلمة بأنها مؤرشفة.' } },
            }, {
              button: 'unarchive',
              when: archivedRow,
              label: { en: 'Unarchive', ar: 'إلغاء الأرشفة' },
              fields: ['reason'],
              reload: true,
              confirm: { title: { en: 'Unarchive this session?', ar: 'إلغاء أرشفة هذه الجلسة؟' }, body: { en: 'It is open again as it was.', ar: 'تعود مفتوحة كما كانت.' } },
            }),
          }]),
        },
      },
    },
    service: {
      operations: {
        ...defaultOperations,
        // Runs as `updateMany` does, one `update` per matched row under the same access, and writes
        // nothing but the mark.
        archiveMany: { steps: ({ steps }) => [archiveAll, steps.updateMany] },
        archive: {
          targets: { dashboard: { fields: { reason } } },
          input: () => reasonInput('sessions.operations.archive'),
          steps: ({ steps }) => [marks(true), steps.update],
        },
        unarchive: {
          targets: { dashboard: { fields: { reason } } },
          input: () => reasonInput('sessions.operations.unarchive'),
          steps: ({ steps }) => [marks(false), steps.update],
        },
      },
    },
  },
  fields: {
    ...defaultFields,
    organization,
    course: {
      kind: 'relationship',
      label: { en: 'Course', ar: 'الدورة' },
      relationTo: () => courses,
      rules: { required: true },
    },
    startsAt: { kind: 'datetime', label: { en: 'Starts at', ar: 'وقت البداية' }, rules: { required: true } },
    // A session with room for nobody is not a session, so one is the floor.
    capacity: { kind: 'number', label: { en: 'Capacity', ar: 'السعة' }, rules: { min: 1 } },
    venue: {
      kind: 'text', label: { en: 'Venue', ar: 'المكان' },
      options: [
        { value: 'online', label: { en: 'Online', ar: 'عبر الإنترنت' } },
        { value: 'campus', label: { en: 'Campus', ar: 'الحرم' } },
      ],
      targets: { dashboard: { component: 'nativeSelect' } },
    },
    format: {
      kind: 'text', label: { en: 'Format', ar: 'الصيغة' },
      options: [
        { value: 'workshop', label: { en: 'Workshop', ar: 'ورشة عمل' } },
        { value: 'lecture', label: { en: 'Lecture', ar: 'محاضرة' } },
      ],
      targets: { dashboard: { component: 'combobox' } },
    },
    // Never by a create. `archive`, `unarchive` and `archiveMany` write it, and so does a plain update by a
    // role holding its key, since the bulk archive runs one plain update per row.
    archived: { kind: 'checkbox', label: { en: 'Archived', ar: 'مؤرشفة' }, rules: { providedBy: { create: 'never' } } },
    details: { kind: 'richText', label: { en: 'Details', ar: 'التفاصيل' } },
    /**
     * The enrollments that point at this session: the one kind that builds no column. `enrollments.session`
     * holds this row's id, so a read populates the array through the enrollments kayan's own access and
     * soft-delete filter, and a read that names no `depth` populates none of it.
     */
    enrollments: {
      kind: 'join',
      relationTo: 'enrollments',
      on: 'session',
      label: { en: 'Enrollments', ar: 'التسجيلات' },
    },
    // Why it was last archived or brought back. Declared last, so a pushed table and a migrated one
    // hold the column in the same place.
    archiveReason: { kind: 'text', label: { en: 'Archive reason', ar: 'سبب الأرشفة' }, rules: { maxLength: 200 } },
  },
})
