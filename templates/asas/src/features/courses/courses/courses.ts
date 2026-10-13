import { defaultFields, draftFields, folderOf, invalid, type Ctx, type ReadTools, type WriteTools } from 'mithaq'
import { z } from 'zod'
import { defineKayan, organization } from '../../../mithaq.ts'
import { activity, appPage, danger, platformList, platformRecord, topPage } from '../../../mithaq/pages.ts'
import { readsPast } from '../../../roles/tenant-access.ts'
import { sessions } from '../sessions/sessions.ts'
import { media } from '../media/media.ts'
import { onOffer } from './ui/on-offer.ts'
import { expectedUpdatedAt } from '../../../steps/expected-updated-at.ts'

/**
 * Page pieces only this kayan draws with. What both screens share is reached
 * through `ui`, `dashboardUi` and `portalUi` from `../mithaq.ts`.
 */
const ui = folderOf(new URL('./ui/', import.meta.url))
/** What a fee column draws on every screen. */
const feeCell = ui('fee-cell.tsx#FeeCell')
/** What the list's Status column draws. */
const statusCell = ui('status-cell.tsx#StatusCell')

/**
 * What `archive` parses. The error messages are this project's own copy keys: a
 * refusal's message is the key the form resolves. Without them the form draws what zod
 * wrote, in English.
 */
const archiveInput = z.object({
  id: z.guid(),
  reason: z
    .string({ error: 'courses.operations.archive.reason.required' })
    .max(200, { error: 'courses.operations.archive.reason.maxLength' }),
})

/** The box `archive`'s dialog asks for on every screen that draws its button. */
const reason = {
  kind: 'text',
  label: { en: 'Reason', ar: 'السبب' },
  rules: { required: true, maxLength: 200 },
} as const

/**
 * The one step `archive` adds: it turns the operation's `reason` into the two
 * columns the kayan has, so `reason` never has to be a field.
 */
const markArchived = (ctx: Ctx<z.infer<typeof archiveInput>>): Ctx => {
  const { reason } = ctx.data
  // Spread `ctx.data` to keep what the runner filled before this step, such as
  // `updatedAt`. `reason` reaches no column: the store step writes the kayan's own fields alone.
  return { ...ctx, data: { ...ctx.data, archived: true, archiveReason: reason } }
}

/** When the access code is drawn: while the form holds a live delivery, redrawn as the delivery changes. */
const live = { delivery: { equals: 'live' } }
/** When an archive button is drawn: over a row not archived yet, on every page that draws one. */
const unarchived = { or: [{ 'record.archived': { exists: false } }, { 'record.archived': { equals: false } }] }

/** Whether the actor runs the catalogue and so reads every course and every session. */
export const runsCatalogue = (user: unknown): boolean => readsPast(user, 'courses.archive') || readsPast(user, 'screen.dashboard')

/**
 * Archived courses are closed to students and instructors and open to whoever
 * runs the catalogue. The dashboard's screen key counts because the registrar
 * reads archived courses there without holding `courses.archive`. Every read
 * answers from this, including relationships; the portal's `baseFilter` only
 * narrows its list. Both arms, since a row from before the column existed holds `null`.
 */
const archivedToArchivers = ({ user }: { user: unknown }) =>
  runsCatalogue(user) ? true : { or: [{ archived: { exists: false } }, { archived: { equals: false } }] }

/**
 * What a course's create and edit pages both draw, written once so the two
 * cannot drift. The access code follows the delivery the form holds.
 */
const details = [
  { section: 'about', label: { en: 'About the course', ar: 'عن الدورة' }, fields: ['title', 'summary', 'cover', 'details'] },
  { section: 'pricing', label: { en: 'Pricing', ar: 'التسعير' }, fields: [{ row: ['fee', 'currency'] }] },
  { section: 'teaching', label: { en: 'Teaching', ar: 'التدريس' }, fields: ['delivery', { field: 'accessCode', when: live }, 'notifications'] },
] as const
const catalogue = { section: 'catalogue', label: { en: 'Catalogue', ar: 'الدليل' }, fields: ['tags'] } as const
/**
 * The edit page's Catalogue, with `archived` read only: a course is archived
 * through `archive` alone, which records its reason. A create leaves it out.
 */
const archivedCatalogue = { ...catalogue, fields: [...catalogue.fields, { field: 'archived', readOnly: true }] } as const

/** What a course's create operation accepts for each session it makes with it. */
const sessionInput = z.object({ startsAt: z.date(), capacity: z.number().nullish() })

/**
 * The step after `insert`. Each session is one managed write through
 * `tools.of(sessions)`, which carries the actor, the depth counter and the
 * transaction, so a session that throws rolls the course back.
 *
 * `sessions` imports this module for its `course` thunk, so the parameters and
 * the return are annotated: inferring them from that call would make the two
 * kayans' types circular.
 */
const createSessions = async (
  ctx: Ctx<{ id?: string; _status?: string | null; sessions?: readonly z.infer<typeof sessionInput>[] }>,
  tools: WriteTools,
): Promise<Ctx> => {
  const { id, _status, sessions: made } = ctx.data
  if (!made?.length) return ctx
  // A draft is read by no plain read, so a session pointing at it would name a
  // course that read cannot show. The runner has written `_status` by now; the
  // throw rolls the course back.
  if (_status === 'draft') {
    throw invalid({
      message: 'A course saved as a draft makes no sessions. Publish the course, then add its sessions.',
      key: 'error.invalid.draft_sessions',
      params: { kayan: 'courses' },
    })
  }
  // The insert step has run, so `id` is set; the create shape types it optional
  // because a caller may leave it to the column's default.
  if (!id) throw new Error('The course was inserted with no id, so its sessions have nothing to point at.')
  for (const session of made) {
    await tools.of(sessions).create({ ...session, course: id })
  }
  return ctx
}

/** What `findWithSessions` puts on the course, one entry per session it may read. */
const sessionRow = z.object({
  id: z.guid(),
  startsAt: z.date(),
  capacity: z.number().nullable(),
})

/**
 * The step after `findOne`. The course is loaded by then, so its sessions are
 * one managed read through `tools.of(sessions)`, which runs the sessions kayan's own
 * access, so a session this actor may not read is not in what comes back. A
 * limit of zero is no page limit.
 */
const attachSessions = async (ctx: Ctx, tools: ReadTools): Promise<Ctx> => {
  // `ctx.data` is typed as what the operation parses, but this step runs after
  // `findOne`, which leaves the row or `null`: narrow it rather than cast.
  const course: unknown = ctx.data
  if (!course || typeof course !== 'object' || !('id' in course) || typeof course.id !== 'string') return ctx
  const found = await tools.of(sessions).find({
    where: { course: { equals: course.id } },
    limit: 0,
  })
  return { ...ctx, data: { ...course, sessions: found.docs } }
}

export const courses = defineKayan({
  name: 'courses',
  // ANDed with the inherited rows, so it narrows and never widens.
  access: { read: archivedToArchivers },
  /**
   * The singular and plural names are reserved keys of the kayan's own copy
   * scope. The nav and every screen's heading read them, and a kayan that
   * declares neither is shown under its own name.
   */
  messages: {
    singular: { en: 'Course', ar: 'دورة' },
    plural: { en: 'Courses', ar: 'الدورات' },
    // Nested under the field's own name so that name is written once; `buildAsas`
    // joins the parts into `fee.invalid` and `fee.min`. `fee` carries its own zod
    // shape, so mithaq seeds neither key: declaring them here keeps
    // `mithaq generate messages` from pruning them.
    fee: {
      invalid: { en: 'A fee is a number.', ar: 'الرسوم رقم.' },
      min: { en: 'A fee is never negative.', ar: 'الرسوم لا تكون سالبة أبدًا.' },
    },
  },
  targets: {
    /** Every organization's rows on the platform, read-only, with each row's record page and its sessions. */
    platform: {
      useAsTitle: 'title',
      pages: {
        ...platformList('/courses', { columns: ['title', 'organization', 'fee', 'archived', 'createdAt'], filters: ['organization', 'title', 'fee', 'archived'], search: ['title'], sort: '-createdAt' }),
        ...platformRecord({
          path: '/courses/:id',
          main: [{ tabs: [
            { tab: 'details', label: { en: 'Details', ar: 'التفاصيل' }, fields: [
              { section: 'about', label: { en: 'About the course', ar: 'عن الدورة' }, fields: ['title', 'summary', 'details'] },
              { section: 'pricing', label: { en: 'Pricing', ar: 'التسعير' }, fields: [{ row: ['fee', 'currency'] }, 'audience', 'topics'] },
              { section: 'teaching', label: { en: 'Teaching', ar: 'التدريس' }, fields: ['delivery', 'accessCode', 'level', 'opensOn'] },
              { section: 'notes', label: { en: 'Notes', ar: 'ملاحظات' }, fields: ['archiveReason'] },
            ] },
            { tab: 'sessions', label: { en: 'Sessions', ar: 'الجلسات' }, fields: [{ list: {
              of: 'sessions',
              where: 'course',
              columns: ['startsAt', 'capacity', 'venue', 'format', 'archived'],
              filters: ['venue', 'archived'],
              search: ['venue'],
              sort: 'startsAt',
            } }] },
          ] }],
          side: [{ section: 'catalogue', label: { en: 'Catalogue', ar: 'الدليل' }, fields: ['tags', 'archived', 'notifications'] }],
        }),
      },
    },
    /**
     * A course keeps a copy of itself on every write. A change may be saved as a
     * draft, autosaved in place, before it is published; a plain read leaves a
     * course never published out.
     */
    versions: { drafts: { autosave: true } },
    /**
     * The operations this kayan adds or restates. The store and schema they run
     * through are the service target's own.
     */
    service: {
      // The defaults hold versions' three operations too, since a course keeps its versions.
      operations: ({ defaults }) => ({
        ...defaults,
        /**
         * The shipped create list with one step added and one shape widened:
         * `sessions` is part of the create signature without being a column, since
         * the store step writes the kayan's own fields alone.
         */
        create: {
          input: ({ create }) => create.extend({ sessions: z.array(sessionInput).optional() }),
          steps: ({ steps }) => [steps.insert, createSessions],
        },
        /**
         * The shipped update and delete lists with the `expectedUpdatedAt` step
         * before each, and each input widened by the key the step reads. A draft
         * reader holds the instant of the row's latest version, so a draft save,
         * an autosave, a publish or a Discard is refused 409 when another writer
         * saved since. The edit form sends the key on each; it stays optional, so
         * a caller that sends none, a bulk among them, writes as before.
         */
        update: {
          input: ({ update }) => update.extend({ expectedUpdatedAt: z.date().optional() }),
          steps: ({ steps }) => [expectedUpdatedAt, steps.update],
        },
        delete: {
          input: ({ id }) => id.extend({ expectedUpdatedAt: z.date().optional() }),
          steps: ({ steps }) => [expectedUpdatedAt, steps.remove],
        },
        /**
         * A restore takes the key too, so Discard changes and a restore from the
         * Versions tab are refused 409 over a newer draft another person saved,
         * which a restore would otherwise bury.
         */
        restoreVersion: {
          input: ({ id }) => id.extend({ expectedUpdatedAt: z.date().optional() }),
          steps: ({ steps }) => [expectedUpdatedAt, steps.restoreVersion],
        },
        /**
         * A custom operation is one more list and gets what `create` gets: the
         * transaction, the parse and the defaults. Its name is the action an access
         * row grants. Naming `input` orders the two the runner owns: the caller's
         * shape is parsed first and the defaults fill after it, so `updatedAt` moves
         * as in the shipped `update` without this strict shape naming a key the
         * caller never sends.
         */
        archive: {
          // What a screen's button asks for beyond the row's id, said as fields: the
          // dialog draws `reason` through the control every text field uses and keys
          // its label `courses.operations.archive.reason`. `buildAsas` refuses a
          // field it names no key for. The portal declares the same box, because a
          // screen that declares none has no dialog, sends no reason and is refused.
          targets: { dashboard: { fields: { reason } }, portal: { fields: { reason } } },
          // The schema is named at the top of the file beside the step that reads it,
          // so one shape types both the parse and `ctx.data`.
          input: () => archiveInput,
          steps: ({ steps }) => [markArchived, steps.update],
        },
        /**
         * A read list with one step of its own and an `output` written the way
         * `input` is, run once at `buildAsas`. It types `sessions` on the result,
         * which no field declares and the row boundary does not know.
         */
        findWithSessions: {
          // The id and nothing else, picked off the derived row shape. The row is
          // stripped rather than strict, because it comes from the store; `.strict()`
          // puts that refusal back.
          input: ({ row }) => row.pick({ id: true }).strict(),
          steps: ({ steps }) => [steps.findOne, attachSessions],
          output: ({ row }) => row.extend({ sessions: z.array(sessionRow) }),
        },
      }),
    },
    dashboard: {
      // What this kayan is for, drawn under the list heading and the form title.
      // One string per declared locale, keyed `courses.description`.
      description: {
        en: 'Everything on offer in the catalogue, and what a seat on each costs.',
        ar: 'كل ما هو معروض في الدليل، وما يكلفه مقعد في كل منها.',
      },
      useAsTitle: 'title',
      // Each page is one tree: the `app` shell at its root with the title in its
      // header and the nav in its nav region, a layout in its main region, and what
      // fills each region. Between them they draw a row, sections, tabs, a related
      // list, a component, a danger-zone button that asks before it runs, and a
      // read-only leaf. The board is rooted at the second shell, `top`, and names
      // its layout and component by `ui()`.
      pages: {
        list: {
          path: '/courses',
          page: appPage([{ layout: 'table', main: [{ list: {
            // `_status` says whether each row is a draft or published, since this
            // list reads every row's latest draft.
            columns: ['title', 'fee', 'archived', 'opensOn', '_status', 'details', 'cover'],
            filters: ['title', 'fee', 'archived'],
            // `details` is searched because this list names it: a rich text field
            // offers itself to no search box on its own.
            search: ['title', 'summary', 'details'],
            empty: ui('no-courses.tsx#NoCourses'),
            // Over the ticked rows: a delete behind its question, and one dialog that
            // writes the fields it names over every one of them.
            bulk: [
              {
                button: 'deleteMany',
                label: { en: 'Delete', ar: 'حذف' },
                confirm: {
                  title: { en: 'Delete the ticked courses?', ar: 'حذف الدورات المحددة؟' },
                  body: { en: 'This cannot be undone.', ar: 'لا يمكن التراجع عن هذا.' },
                },
              },
              { button: 'updateMany', label: { en: 'Update', ar: 'تحديث' }, fields: ['fee', 'archived'] },
            ],
            // On each row not archived yet, the edit page's own archive,
            // asking for its reason.
            row: [{
              button: 'archive',
              when: unarchived,
              label: { en: 'Archive', ar: 'أرشفة' },
              fields: ['reason'],
            }],
          } }] }]),
        },
        // The edit page's Details and Catalogue, and nothing that needs a row yet:
        // no Sessions or Versions tab, no activity, no danger zone.
        create: {
          path: '/courses/new',
          page: appPage([{ layout: 'record', main: [{ form: details }], side: [catalogue] }]),
        },
        // The editor's tabs sit across the page, outside the cards. On Details a
        // main column of sectioned fields has a side column beside it, and the danger
        // zone is at its foot. Sessions and Versions take the page's full width, and
        // the form's controls sit in the header on every tab. The page names every
        // field it draws, and no id, tenant or timestamp.
        edit: {
          path: '/courses/:id',
          page: appPage([{ tabs: [
            { tab: 'details', label: { en: 'Details', ar: 'التفاصيل' }, fields: [{
              layout: 'record',
              main: [{ form: details }],
              // Beside the form, what was done to this row, by whom and when.
              side: [archivedCatalogue, activity],
              // Where a button sits is where it is drawn: the archive in the record
              // layout's danger zone, asking before it runs and only over a row not
              // archived yet, before the delete every edit page ends its danger zone with.
              danger: danger({
                button: 'archive',
                when: unarchived,
                label: { en: 'Archive', ar: 'أرشفة' },
                fields: ['reason'],
                reload: true,
                confirm: {
                  title: { en: 'Archive this course?', ar: 'أرشفة هذه الدورة؟' },
                  body: { en: 'It leaves the catalogue for every student.', ar: 'تخرج من الدليل لكل الطلاب.' },
                },
              }),
            }] },
            // The sessions are rows of another kayan pointing at this one: a list of
            // `sessions` whose `course` is this row, searched, filtered and paged on
            // the server, each row edited in place below the table or on its own page,
            // and every write the sessions kayan's own, apart from this form's save.
            { tab: 'sessions', label: { en: 'Sessions', ar: 'الجلسات' }, fields: [{ list: {
              of: 'sessions',
              where: 'course',
              columns: ['startsAt', 'capacity', 'venue', 'format', 'archived'],
              filters: ['venue', 'archived'],
              search: ['venue'],
              sort: 'startsAt',
              bulk: [{
                button: 'archiveMany',
                label: { en: 'Archive', ar: 'أرشفة' },
                confirm: {
                  title: { en: 'Archive the ticked sessions?', ar: 'أرشفة الجلسات المحددة؟' },
                  body: { en: 'They stay on the course, marked archived.', ar: 'تبقى في الدورة، معلمة بأنها مؤرشفة.' },
                },
              }],
            } }] },
            // The row's versions, newest first, each restored behind its confirm,
            // drawn only for an actor holding the key that reads them; a tab whose
            // every node is hidden is not drawn at all.
            { tab: 'versions', label: { en: 'Versions', ar: 'الإصدارات' }, fields: [
              { component: 'versions', when: { '$user.collections.courses.operations.findVersions': { equals: true } } },
            ] },
          ] }]),
        },
        board: {
          path: '/courses/board',
          page: { shell: 'top', header: [{ title: {} }], nav: [{ nav: {} }], main: [{ layout: 'table', main: [{ component: ui('no-courses.tsx#NoCourses') }] }] },
        },
      },
    },
    /**
     * A shorter list and form than the dashboard's: `currency` as `radio` where
     * the dashboard draws `select`, and `audience` as a row of buttons, from the
     * one declaration of each field. Its row archive asks for a reason as the
     * dashboard's does, and its edit page's archive is a component of the
     * portal's own. It lists the courses on offer alone: an archived course is
     * left out of its list and its home's count, and its page opens for no
     * student or instructor.
     */
    portal: {
      useAsTitle: 'title',
      baseFilter: onOffer,
      description: { en: 'The courses on offer.', ar: 'الدورات المعروضة.' },
      pages: {
        list: {
          path: '/courses',
          // Opens by title and 25 to a page, which the URL overrides, with
          // the same archive on each row not archived yet.
          page: topPage([{ layout: 'page', main: [{ list: {
            columns: ['title', 'fee'],
            filters: ['title'],
            search: ['title'],
            empty: ui('no-courses-on-offer.tsx#NoCourses'),
            sort: 'title',
            limit: 25,
            row: [{
              button: 'archive',
              when: unarchived,
              label: { en: 'Archive', ar: 'أرشفة' },
              fields: ['reason'],
            }],
          } }] }]),
        },
        // The dashboard's record layout: the form's fields in sections, and the
        // archive in the danger zone under it, only over a row not archived yet,
        // drawn by the portal's own button, which writes the reason in the viewer's locale.
        edit: {
          path: '/courses/:id',
          page: topPage([{
            layout: 'record',
            main: [{ form: [
              { section: 'about', label: { en: 'About the course', ar: 'عن الدورة' }, fields: ['title', 'summary', 'cover', 'details'] },
              { section: 'pricing', label: { en: 'Pricing', ar: 'التسعير' }, fields: [{ row: ['fee', 'currency'] }, { field: 'audience', component: 'buttonGroup' }] },
              { section: 'teaching', label: { en: 'Teaching', ar: 'التدريس' }, fields: ['delivery', { field: 'accessCode', when: live }, 'opensOn'] },
            ] }],
            // Drawn only for a viewer who may archive, so a danger zone with
            // nothing in it is not drawn at all.
            danger: [{
              button: 'archive',
              when: { and: [unarchived, { '$user.collections.courses.operations.archive': { equals: true } }] },
              label: { en: 'Archive', ar: 'أرشفة' },
              reload: true,
              component: ui('archive-button.tsx#ArchiveButton'),
              confirm: { title: { en: 'Archive this course?', ar: 'أرشفة هذه الدورة؟' }, body: { en: 'Students stop seeing it.', ar: 'يتوقف الطلاب عن رؤيتها.' } },
            }],
          }]),
        },
      },
    },
  },
  fields: {
    ...defaultFields,
    organization,
    title: {
      kind: 'text',
      label: { en: 'Title', ar: 'العنوان' },
      // What the field is and the hint its empty control shows, written once
      // at the field's root and drawn the same on every screen. Both are copy,
      // keyed `courses.title.description` and `courses.title.placeholder`.
      description: { en: 'The name a student sees in the catalogue.', ar: 'الاسم الذي يراه الطالب في الدليل.' },
      placeholder: { en: 'Introduction to Arabic calligraphy', ar: 'مقدمة في الخط العربي' },
      // What the input group draws before the value, one string per locale,
      // on every screen that draws the field.
      prefix: { en: 'Course', ar: 'دورة' },
      targets: {
        dashboard: {
          filter: true,
          // What the list's search box runs a `like` over. One opt-in per
          // field, so a name no field of this kayan carries cannot be written.
          searchable: true,
        },
      },
      // Trimmed before it is judged, so a title of spaces alone is refused as
      // required on publish rather than saved as a course with no name. A draft
      // save parses the kinds alone and keeps it.
      rules: { required: true, trim: true, maxLength: 120, index: true },
    },
    // Optional, and carrying a length rule: the rule has to run on the string
    // shape, which is only true while the shape is still a string.
    summary: {
      kind: 'text',
      label: { en: 'Summary', ar: 'الملخص' },
      rules: { maxLength: 200 },
      // Searched beside the title, and never ordered by: a summary is a
      // paragraph, so a page sorted by it reads as an arbitrary order, and a
      // caller naming it is refused the way a caller naming a localized field is.
      targets: { dashboard: { searchable: true, sortable: false } },
    },
    // A fee is never negative. `rules: { min: 0 }` would say so with the same
    // two keys; the shape is this field's own on purpose, as the template's one
    // field that carries its whole zod shape. It is `nullish` because the form
    // sends `null` for a fee it cleared. The column stays derived.
    //
    // A shape written here is one mithaq wrote none of, so it names its own copy
    // keys or an Arabic reader gets zod's English: `courses.fee.invalid` for a
    // value that is not a number and `courses.fee.min` for a negative one.
    // Neither is seeded, because the seed loop passes over a field whose schema
    // target carries its own shape; this kayan's `messages` entry above claims both.
    fee: {
      kind: 'number',
      label: { en: 'Fee', ar: 'الرسوم' },
      // And after it: what one fee buys.
      suffix: { en: 'per seat', ar: 'لكل مقعد' },
      // A column reads the fee in the row's own currency on every screen
      // A column reads the fee in the row's own currency on every screen.
      targets: {
        zod: z.number({ error: 'courses.fee.invalid' }).nonnegative({ error: 'courses.fee.min' }).nullish(),
        dashboard: { filter: true, cell: feeCell },
        portal: { cell: feeCell },
        platform: { cell: feeCell },
      },
    },
    currency: {
      kind: 'text',
      label: { en: 'Currency', ar: 'العملة' },
      options: [
        { value: 'SAR', label: { en: 'Saudi riyal', ar: 'ريال سعودي' } },
        { value: 'USD', label: { en: 'US dollar', ar: 'دولار أمريكي' } },
      ],
      // One field, drawn as a `select` on the dashboard and as `radio` on the
      // portal: what it holds is written once, and each screen says only how
      // it draws it.
      targets: { dashboard: { component: 'select' }, portal: { component: 'radio' } },
    },
    level: {
      kind: 'number', label: { en: 'Level', ar: 'المستوى' }, rules: { min: 1, max: 5 },
      targets: { dashboard: { component: 'slider' } },
    },
    notifications: {
      kind: 'checkbox', label: { en: 'Notifications', ar: 'الإشعارات' },
      targets: { dashboard: { component: 'switch', cell: 'checkbox' } },
    },
    delivery: {
      kind: 'text', label: { en: 'Delivery', ar: 'طريقة التقديم' },
      options: [
        { value: 'live', label: { en: 'Live', ar: 'مباشر' } },
        { value: 'recorded', label: { en: 'Recorded', ar: 'مسجل' } },
      ],
      // A choice on both screens, so each reads the option's label in the
      // viewer's locale and never the stored value.
      targets: { dashboard: { component: 'radio' }, portal: { component: 'radio' } },
    },
    audience: {
      kind: 'text', label: { en: 'Audience', ar: 'الجمهور' },
      options: [
        { value: 'beginner', label: { en: 'Beginner', ar: 'مبتدئ' } },
        { value: 'advanced', label: { en: 'Advanced', ar: 'متقدم' } },
      ],
      targets: { dashboard: { component: 'toggleGroup' } },
    },
    accessCode: {
      kind: 'text', label: { en: 'Access code', ar: 'رمز الدخول' }, rules: { maxLength: 6 },
      targets: { dashboard: { component: 'otp' } },
    },
    archived: { kind: 'checkbox', label: { en: 'Archived', ar: 'مؤرشف' }, targets: { dashboard: { filter: true } } },
    // What a course covers, several at once out of a closed list. A course names
    // at most two, so a third box ticked is refused before the save. No floor: an
    // optional list left empty passes any `minRows`, and a list that is there
    // holds one already.
    topics: {
      kind: 'textArray',
      label: { en: 'Topics', ar: 'المواضيع' },
      rules: { maxRows: 2 },
      options: [
        { value: 'script', label: { en: 'Script', ar: 'الخط' } },
        { value: 'grammar', label: { en: 'Grammar', ar: 'النحو' } },
        { value: 'recitation', label: { en: 'Recitation', ar: 'التلاوة' } },
      ],
    },
    // The day enrolment opens, a calendar day with no time of its own, which
    // the portal draws as the platform's own day picker.
    opensOn: { kind: 'date', label: { en: 'Opens on', ar: 'يفتح في' } },
    archiveReason: {
      kind: 'text',
      label: { en: 'Archive reason', ar: 'سبب الأرشفة' },
      rules: { maxLength: 200 },
    },
    // The many-to-many: no column on this table at all, and a join table
    // `courses_tags` the store writes in the same transaction the course is
    // written in. The whole array replaces the old set on an update, and the join
    // rows go with the course when it is deleted.
    tags: {
      kind: 'relationship',
      relationTo: 'tags',
      hasMany: true,
      label: { en: 'Tags', ar: 'الوسوم' },
    },
    // The same rows a read with a depth populates. A page draws them as the list
    // of `sessions` on the edit page's Sessions tab, and never as a leaf.
    scheduledSessions: {
      kind: 'join', relationTo: 'sessions', on: 'course',
      label: { en: 'Scheduled sessions', ar: 'الجلسات المجدولة' },
    },
    // Whether this course is a draft or published; a kayan that keeps drafts spreads these last.
    ...draftFields,
    _status: { ...draftFields._status, targets: { dashboard: { cell: statusCell } } },
    // What the course covers at length, as Lexical's editor state, drawn by the
    // registry's editor and read by its viewer, and as its plain text in a list.
    // Declared last so a pushed table and a migrated one hold the column in the same place.
    details: { kind: 'richText', label: { en: 'Details', ar: 'التفاصيل' } },
    // The course's cover, one of the organization's images. Its row cannot be
    // deleted while a course points at it, since an upload restricts. Declared
    // last, for the same column order.
    cover: { kind: 'upload', relationTo: () => media, label: { en: 'Cover image', ar: 'صورة الغلاف' } },
  },
})
