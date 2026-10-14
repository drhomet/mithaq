// Fills a database with a working organization's worth of rows, so the dashboard
// can be tried with something in it.
//
//   DATABASE_URL=postgres://... npm run seed
//
// It fills the organization named SEED_ORGANIZATION that the user signing in as
// SEED_EMAIL owns. SEED_EMAIL unset is the first user to sign up, and
// SEED_ORGANIZATION unset the first organization that user owns. A development
// tool only: nothing in production reads it.
//
// Every row is written through the built asas's own operations, as that
// organization's owner, so access, validation, option lists and the
// organization the runner fills apply exactly as they do to a person in the dashboard.
// Running it twice adds nothing: each row is looked up by a key that does not
// change between runs and is skipped where it is already there.
import { createHmac } from 'node:crypto'
import { organizations as mode } from '@asas/mithaq/auth/organizations'
// add-on: courses
import type { RichTextNode, RichTextValue } from 'mithaq'
// end add-on: courses

function refuse(reason: string): never {
  console.error(`Refusing to seed: ${reason}`)
  process.exit(1)
}

// The language falls back to the local development database when no URL is set,
// which is right for the dev server and wrong here: a seed writes, so it runs
// only against a database someone named. Checked before the build is imported,
// since the import is what reads it.
if (!process.env.DATABASE_URL) refuse('set DATABASE_URL to the database to fill. Nothing is seeded by default.')
if (process.env.NODE_ENV === 'production') refuse('NODE_ENV is production, and the seed fills a development database only.')
const { SEED_EMAIL, SEED_ORGANIZATION } = process.env
// Without a name the seed picks whoever signed up first, which on a shared
// database is someone's real organization. So it fills only this machine's
// database by itself, and another only when told whose and told twice. pg
// takes a `?host=` over the URL's own host, the last one when repeated, and a
// path there is a socket on this machine.
const { hostname, port, pathname, searchParams } = new URL(process.env.DATABASE_URL)
const host = searchParams.getAll('host').at(-1) || hostname
const database = `${host}:${searchParams.getAll('port').at(-1) || port || '5432'}/${decodeURIComponent(pathname.slice(1))}`
if (!host.startsWith('/') && !['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
  if (!SEED_EMAIL) refuse(`DATABASE_URL names ${database}, which is not this machine. Name the owner whose organization to fill there with SEED_EMAIL, and set SEED_ALLOW_REMOTE=1.`)
  if (process.env.SEED_ALLOW_REMOTE !== '1') {
    refuse(`DATABASE_URL names ${database}, which is not this machine. Set SEED_ALLOW_REMOTE=1 to fill ${SEED_ORGANIZATION ? `the organization "${SEED_ORGANIZATION}"` : 'the first organization'} that ${SEED_EMAIL} owns there.`)
  }
}

const { asas } = await import('./asas.ts')

/** A generator of the same numbers on every run, so the plan a second run makes is the plan the first one wrote. */
const seeded = (state: number) => () => {
  state = (state + 0x6d2b79f5) | 0
  let t = Math.imul(state ^ (state >>> 15), 1 | state)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const random = seeded(20260927)
const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)]!

const DAY = 86_400_000
const now = Date.now()

// add-on: courses
/** One entry per course: the title it is found by on a later run, and a summary in the other locale. */
const catalogue = [
  ['Introduction to Arabic calligraphy', 'مدخل إلى الخط العربي بأدواته وأساسياته', ['script']],
  ['Naskh script from first strokes', 'خط النسخ من الحروف المفردة إلى الكلمات', ['script']],
  ['Thuluth for advanced students', 'خط الثلث للمتقدمين وتركيب اللوحات', ['script']],
  ['Diwani and decorative lettering', 'الخط الديواني والكتابة الزخرفية', ['script']],
  ['Arabic grammar essentials', 'أساسيات النحو العربي للمبتدئين', ['grammar']],
  ['Morphology and verb patterns', 'علم الصرف وأوزان الأفعال', ['grammar']],
  ['Rhetoric in classical texts', 'البلاغة في النصوص الكلاسيكية', ['grammar']],
  ['Reading classical poetry', 'قراءة الشعر العربي القديم وتذوقه', ['grammar', 'recitation']],
  ['Tajweed rules for beginners', 'أحكام التجويد للمبتدئين', ['recitation']],
  ['Quran recitation practice circle', 'حلقة تدريب على التلاوة', ['recitation']],
  ['Makharij al-huruf in depth', 'مخارج الحروف وصفاتها بالتفصيل', ['recitation']],
  ['Memorisation techniques', 'أساليب الحفظ والمراجعة', ['recitation']],
  ['Modern Standard Arabic conversation', 'المحادثة بالعربية الفصحى المعاصرة', ['grammar']],
  ['Arabic for business correspondence', 'العربية في المراسلات التجارية', ['grammar', 'script']],
  ['Children\'s handwriting workshop', 'ورشة تحسين الخط للأطفال', ['script']],
  ['Illumination and manuscript art', 'فن التذهيب وزخرفة المخطوطات', ['script']],
  ['Prosody and poetic metres', 'علم العروض وبحور الشعر', ['grammar', 'recitation']],
  ['Dictation and spelling', 'الإملاء وقواعد الكتابة', ['grammar', 'script']],
  ['Public speaking in Arabic', 'فن الخطابة والإلقاء بالعربية', ['recitation']],
  ['Teaching Arabic to non-native speakers', 'تعليم العربية للناطقين بغيرها', ['grammar']],
] as const

/** Lexical's editor state holding these blocks, the shape a `richText` field stores. */
const richText = (...children: RichTextNode[]): RichTextValue => ({ root: { type: 'root', version: 1, direction: null, format: '', indent: 0, children } })
const words = (text: string, format = 0): RichTextNode => ({ type: 'text', version: 1, text, format, detail: 0, mode: 'normal', style: '' })
const block = (type: string, children: RichTextNode[], more: Record<string, unknown> = {}): RichTextNode => ({ type, version: 1, direction: null, format: '', indent: 0, children, ...more })
const courseDetails = (title: string, summary: string, topics: readonly string[]) =>
  richText(
    block('heading', [words(title)], { tag: 'h2' }),
    block('paragraph', [words(summary)], { textFormat: 0, textStyle: '' }),
    block('paragraph', [words('Covers ', 0), words(topics.join(', '), 1), words(' · يغطي: ', 0), words(topics.map((topic) => topicNames[topic] ?? topic).join('، '), 1)], { textFormat: 0, textStyle: '' }),
    block('list', [block('listitem', [words('Bring a notebook · أحضر دفترا')], { value: 1 }), block('listitem', [words('Arrive ten minutes early · احضر قبل الموعد بعشر دقائق')], { value: 2 })], { listType: 'bullet', start: 1, tag: 'ul' }),
  )
const topicNames: Record<string, string> = { script: 'الخط', grammar: 'النحو', recitation: 'التلاوة' }
const sessionDetails = (format: 'workshop' | 'lecture') =>
  richText(block('paragraph', [words(format === 'workshop' ? 'A hands-on workshop.' : 'A lecture with questions at the end.')], { textFormat: 0, textStyle: '' }), block('paragraph', [words(format === 'workshop' ? 'ورشة عمل تطبيقية.' : 'محاضرة تتبعها أسئلة.')], { textFormat: 0, textStyle: '' }))
// end add-on: courses

/** A tag's name is copy a screen shows, so it is one string per locale, and a later run finds it by its English. */
const tagNames = [
  { en: 'Beginner friendly', ar: 'مناسب للمبتدئين' },
  { en: 'Weekend', ar: 'عطلة نهاية الأسبوع' },
  { en: 'Online', ar: 'عبر الإنترنت' },
  { en: 'Certificate', ar: 'شهادة' },
  { en: 'Intensive', ar: 'مكثف' },
  { en: 'Children', ar: 'أطفال' },
]

// add-on: roles
/** Three custom roles, each labelled in every locale and holding keys the build's own catalog lists. */
const customRoles = {
  teacher: {
    label: { en: 'Teacher', ar: 'معلم' },
    holds: (key: string) => /^(sessions|enrollments)\./.test(key) || /^courses\.(find|findByID|count|fields\.)/.test(key) || key === 'screen.dashboard',
  },
  accountant: {
    label: { en: 'Accountant', ar: 'محاسب' },
    // Every seat of the organization, not only its own.
    holds: (key: string) => /^(courses|enrollments|sessions)\.(find|findByID|count|fields\.)/.test(key) || key === 'enrollments.others' || key === 'screen.dashboard',
  },
  receptionist: {
    label: { en: 'Receptionist', ar: 'موظف استقبال' },
    holds: (key: string) => /^enrollments\./.test(key) || /^(courses|sessions)\.(find|findByID|count|fields\.)/.test(key) || key === 'screen.dashboard',
  },
}
// end add-on: roles

// The owner and the organization, read through the provider's own adapter:
// the generated auth kayan answer no operation to anyone, so this is how a
// script asks who someone is.
const server = (asas.auth.strategies.find((strategy) => strategy.name === 'user') as unknown as { server: { $context: Promise<AuthContext> } }).server
type Row = Record<string, unknown> & { id: string }
type AuthContext = {
  secret: string
  authCookies: { sessionToken: { name: string } }
  adapter: { findMany(query: { model: string; where?: { field: string; value: string }[]; limit?: number; sortBy?: { field: string; direction: 'asc' } }): Promise<Row[]> }
  internalAdapter: {
    findUserByEmail(email: string): Promise<{ user: Row } | null>
    createSession(userId: string, dontRememberMe?: boolean, override?: Record<string, unknown>): Promise<{ token: string }>
    deleteSession(token: string): Promise<void>
  }
}
const auth = await server.$context

const oldestFirst = { field: 'createdAt', direction: 'asc' } as const
const owner = SEED_EMAIL
  ? (await auth.internalAdapter.findUserByEmail(SEED_EMAIL))?.user
  : (await auth.adapter.findMany({ model: 'user', limit: 1, sortBy: oldestFirst }))[0]
// Where the first owner comes from: the first sign-up with many organizations, first-run otherwise.
const makeOne = mode === 'many' ? 'Sign up in the tenant app and create an organization first.' : 'Set the app up on the tenant app\'s /auth/first-run first.'
if (!owner) refuse(SEED_EMAIL ? `no user signs in as ${SEED_EMAIL}.` : `the database holds no user yet. ${makeOne}`)
const owned = (await auth.adapter.findMany({ model: 'member', where: [{ field: 'userId', value: owner.id }], sortBy: oldestFirst }))
  .filter((member) => String(member.role).split(',').includes('owner'))
  .map((member) => String(member.organizationId))
// A name is not unique, so the organization is the one of that name the owner
// owns, and there has to be exactly one.
const organizations = (await auth.adapter.findMany({ model: 'organization', where: [SEED_ORGANIZATION ? { field: 'name', value: SEED_ORGANIZATION } : { field: 'id', value: owned[0] ?? '' }] }))
  .filter((one) => owned.includes(one.id))
if (organizations.length !== 1) {
  refuse(SEED_ORGANIZATION
    ? `${owner.email} owns ${organizations.length ? 'more than one' : 'no'} organization named "${SEED_ORGANIZATION}".`
    : `${owner.email} owns no organization. ${makeOne}`)
}
const organization = organizations[0]!
console.log(`Seeding the organization "${organization.name}" that ${owner.email} owns, in ${database}.`)
const members = await auth.adapter.findMany({ model: 'member', where: [{ field: 'organizationId', value: organization.id }] })

// A session of the owner's own, in that organization, which the provider
// signs and reads back like any browser's. It is deleted when the seed ends,
// so the run leaves no way in behind it. The cookie is signed the way the
// provider's router signs it.
const { token } = await auth.internalAdapter.createSession(owner.id, true, { activeOrganizationId: organization.id })
const signature = createHmac('sha256', auth.secret).update(token).digest('base64')
const headers = new Headers({ cookie: `${auth.authCookies.sessionToken.name}=${encodeURIComponent(`${token}.${signature}`)}` })

const created = {
  tags: 0,
  // add-on: courses
  courses: 0,
  sessions: 0,
  enrollments: 0,
  // end add-on: courses
  // add-on: roles
  roles: 0,
  memberRoles: 0,
  // end add-on: roles
  // add-on: settings
  settings: 0,
  // end add-on: settings
}
/** The rows this run brought up to date rather than made. */
const repaired = {
  tags: 0,
  tagColumns: 0,
  // add-on: courses
  details: 0,
  // end add-on: courses
  // add-on: roles
  roles: 0,
  // end add-on: roles
}
const client = (asas.targets.drizzle as unknown as { db: { $client: { query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> } } }).db.$client

try {
  // A dev database seeded before a tag's name was localized holds one `name`
  // column where the kayan reads `name_en` and `name_ar`, so every read below
  // would fail. A migrated database gets the change from the committed
  // migration; a dev database is pushed by `connect()` instead, and the push
  // cannot tell a rename from a drop and an add, so it stops on this table.
  // This block makes the change the way the migration does, and a push after it
  // runs clean. `name_ar` starts as a copy of the English because a row the
  // read cannot parse is refused whole; a tag a person made reads in English
  // under Arabic until someone writes its Arabic, which the run reports as
  // `repaired.tagColumns`. The five statements are one query, so postgres runs
  // them as one transaction and a failure leaves the table as it was.
  const columns = new Set((await client.query(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'tags'`)).rows.map((row) => row.column_name))
  if (columns.has('name') && !columns.has('name_en')) {
    await client.query([
      'alter table "tags" rename column "name" to "name_en"',
      'alter table "tags" add column "name_ar" varchar(60)',
      'update "tags" set "name_ar" = "name_en"',
      'alter table "tags" alter column "name_ar" set not null',
      'create index "tags_name_ar_index" on "tags" ("name_ar")',
    ].join('; '))
    repaired.tagColumns = 1
  }
  const actor = await asas.auth.actor(headers)
  if (!actor) throw new Error(`The session made for ${owner.email} did not authenticate.`)
  const options = { actor }
  const { tags } = asas.kayan
  // add-on: courses
  const { courses, sessions, enrollments } = asas.kayan
  // end add-on: courses
  // add-on: roles
  const { roles, memberRoles } = asas.kayan
  // end add-on: roles

  const tagIds: string[] = []
  for (const name of tagNames) {
    const found = (await tags.operations.find({ where: { 'name.en': { equals: name.en } }, limit: 1 }, options)).docs[0]
    if (!found) {
      created.tags++
      tagIds.push((await tags.operations.create({ name }, options)).id)
      continue
    }
    // A tag made before its name was localized carries no Arabic, and is
    // brought to both here; one that already holds both is left alone.
    if (found.name?.ar !== name.ar) {
      await tags.operations.update({ id: found.id, name }, options)
      repaired.tags++
    }
    tagIds.push(found.id)
  }

  // add-on: courses
  // What this run made and when each is said to have been made, for the one
  // write below that goes around the operations.
  const backdate: { table: 'courses' | 'enrollments'; id: string; at: Date }[] = []
  const planned: { course: string; age: number; sessions: string[] }[] = []
  for (const [index, [title, summary, topics]] of catalogue.entries()) {
    // Drawn whether or not the course is there, so every run draws the same plan.
    const age = 89 - index
    const delivery = pick(['live', 'recorded'] as const)
    const input = {
      title,
      summary,
      details: courseDetails(title, summary, topics),
      topics: [...topics],
      fee: pick([0, 150, 250, 300, 450, 600, 900]),
      currency: pick(['SAR', 'USD'] as const),
      level: 1 + Math.floor(random() * 5),
      audience: pick(['beginner', 'advanced'] as const),
      delivery,
      ...(delivery === 'live' && { accessCode: String(100000 + Math.floor(random() * 900000)) }),
      notifications: random() < 0.7,
      opensOn: new Date(now - (age - 7) * DAY).toISOString().slice(0, 10),
      tags: tagIds.filter(() => random() < 0.35),
      // Two of the twenty are archived, with the reason the archive form asks for.
      ...(index % 9 === 8 && { archived: true, archiveReason: 'Replaced by a newer course.' }),
    }
    const sessionCount = 2 + Math.floor(random() * 5)
    const found = (await courses.operations.find({ where: { title: { equals: title } }, limit: 1 }, options)).docs[0]
    const course = found ?? (await courses.operations.create(input, options))
    if (!found) {
      created.courses++
      backdate.push({ table: 'courses', id: course.id, at: new Date(now - age * DAY) })
    } else if (!found.details) {
      // A course seeded without details is given them, once.
      await courses.operations.update({ id: found.id, details: input.details }, options)
      repaired.details++
    }
    // A course's sessions are keyed by their place in its list, which a later
    // run reads back in the order of their start.
    const held = (await sessions.operations.find({ where: { course: { equals: course.id } }, sort: 'startsAt', limit: 0 }, options)).docs.map((one) => one.id)
    for (let at = 0; at < sessionCount; at++) {
      const session = {
        course: course.id,
        startsAt: new Date(now - (60 - index * 3 - at * 7) * DAY + (random() < 0.5 ? 9 : 18) * 3_600_000 - (now % DAY)),
        capacity: 10 + Math.floor(random() * 21),
        venue: pick(['online', 'campus'] as const),
        format: pick(['workshop', 'lecture'] as const),
      }
      if (held[at]) continue
      held.push((await sessions.operations.create({ ...session, details: sessionDetails(session.format) }, options)).id)
      created.sessions++
    }
    planned.push({ course: course.id, age, sessions: held })
  }

  // Sixty enrollments, each on a session of its own drawn from every course's
  // list and taken by the organization's members in turn, so one session and
  // one student are the pair a later run finds it by. Each is said to have
  // been made after its course was, more of them lately than long ago.
  const pairs = planned.flatMap((one) => one.sessions.map((session) => ({ session, age: one.age })))
  for (let at = pairs.length - 1; at > 0; at--) {
    const other = Math.floor(random() * (at + 1))
    ;[pairs[at], pairs[other]] = [pairs[other]!, pairs[at]!]
  }
  for (const [index, { session, age }] of pairs.slice(0, 60).entries()) {
    const student = String(members[index % members.length]!.userId)
    const at = new Date(now - Math.floor(random() ** 2 * age) * DAY - random() * DAY)
    const found = (await enrollments.operations.find({ where: { session: { equals: session }, student: { equals: student } }, limit: 1 }, options)).docs[0]
    if (found) continue
    const made = await enrollments.operations.create({ session, student }, options)
    created.enrollments++
    backdate.push({ table: 'enrollments', id: made.id, at })
  }

  // `createdAt` is the application's, filled in by the create and refused from
  // a caller, so no operation can say a row was made in the past. The
  // dashboard's chart needs a past, so the rows this run just made, and only
  // those, get one here with a plain update through the drizzle target's own
  // connection, keyed on each row's id and this tenant.
  for (const { table, id, at } of backdate) {
    await client.query(`update "${table}" set "created_at" = $1 where "id" = $2 and "organization_id" = $3`, [at, id, organization.id])
  }
  // end add-on: courses

  // add-on: roles
  // A role already there is brought to the keys it would be made with, so a
  // database seeded earlier is repaired by running the seed again. A row that
  // already holds exactly these keys is left alone, so a second run still
  // writes nothing. A row whose label is its slug is brought to its real label
  // the same way.
  for (const [name, { label, holds }] of Object.entries(customRoles)) {
    const permissions = asas.catalog.filter(holds)
    const [found] = (await roles.operations.find({ where: { name: { equals: name } }, limit: 1 }, options)).docs
    if (!found) {
      await roles.operations.create({ name, label, permissions }, options)
      created.roles++
    } else if (JSON.stringify(found.permissions) !== JSON.stringify(permissions) || found.label?.en !== label.en || found.label?.ar !== label.ar) {
      await roles.operations.update({ id: found.id, label, permissions }, options)
      repaired.roles++
    }
  }
  // Each custom role given to a member in turn, the owner included: the
  // owner's own `administrator` already holds every key, so this widens nothing.
  for (const [index, role] of Object.keys(customRoles).entries()) {
    const user = String(members[index % members.length]!.userId)
    if ((await memberRoles.operations.find({ where: { user: { equals: user }, role: { equals: role } }, limit: 1 }, options)).docs.length) continue
    await memberRoles.operations.create({ user, role }, options)
    created.memberRoles++
  }
  // end add-on: roles

  // add-on: settings
  const { settings } = asas.global
  if (!(await settings.operations.findOne({}, options))) {
    await settings.operations.update({ siteTitle: `${organization.name} Academy`, contactEmail: String(owner.email), maintenance: false }, options)
    created.settings++
  }
  // end add-on: settings

  const totals = {
    tags: (await tags.operations.count({}, options)).totalDocs,
    // add-on: courses
    courses: (await courses.operations.count({}, options)).totalDocs,
    sessions: (await sessions.operations.count({}, options)).totalDocs,
    enrollments: (await enrollments.operations.count({}, options)).totalDocs,
    // end add-on: courses
    // add-on: roles
    roles: (await roles.operations.count({}, options)).totalDocs,
    memberRoles: (await memberRoles.operations.count({}, options)).totalDocs,
    // end add-on: roles
    // add-on: settings
    settings: (await settings.operations.findOne({}, options)) ? 1 : 0,
    // end add-on: settings
  }
  console.log(JSON.stringify({ organization: organization.name, created, repaired, totals }))
} finally {
  await auth.internalAdapter.deleteSession(token)
  await asas.destroy()
}
