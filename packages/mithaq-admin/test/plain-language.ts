// A language of the base rukn alone, with no rich text and no files, built offline: its tables are made and nothing connects.
import {
  base,
  defaultAuthorize,
  defaultBulkLimit,
  defaultDepth,
  defaultFields,
  defaultJoinLimit,
  defaultLimit,
  defaultMaxLimit,
  defaultOperations,
  defineMithaq,
  drizzleAdapter,
  drizzleIdKinds, drizzleKinds,
  drizzleRules,
  screenKinds,
  screenTarget,
  serviceTarget,
  zodKinds, zodRules, zodIdKinds, zodTarget,
} from 'mithaq'
import { dashboardScreen } from '../../../templates/mithaq/src/mithaq.ts'

export const language = defineMithaq({
  locales: ['ar', 'en'] as const,
  arkan: [base],
  targets: {
    drizzle: drizzleAdapter({ connectionString: 'postgresql://never-connected', kinds: drizzleKinds, rules: drizzleRules, idKinds: drizzleIdKinds }),
    zod: zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }),
    service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'drizzle', schema: 'zod', authorize: defaultAuthorize }),
    dashboard: screenTarget({ ...dashboardScreen, icons: [], kayan: ['notes'], providers: [], controls: screenKinds, pages: { home: { path: '/', component: dashboardScreen.pages.dashboard!.component } } }),
  },
})

export const notes = language.defineKayan({
  name: 'notes',
  fields: {
    id: defaultFields.id,
    title: { kind: 'text', label: { en: 'Title', ar: 'العنوان' } },
    pinned: { kind: 'checkbox', label: { en: 'Pinned', ar: 'مثبت' } },
  },
  targets: { service: { operations: defaultOperations } },
})
