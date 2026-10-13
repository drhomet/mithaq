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
  drizzleKinds,
  drizzleRules,
  screenKinds,
  screenTarget,
  serviceTarget,
  zodTarget,
} from 'mithaq'
import { dashboardScreen } from '../../../templates/asas/src/mithaq.ts'

export const language = defineMithaq({
  locales: ['ar', 'en'] as const,
  arkan: [base],
  targets: {
    drizzle: drizzleAdapter({ connectionString: 'postgresql://never-connected', kinds: drizzleKinds, rules: drizzleRules }),
    zod: zodTarget,
    service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'drizzle', schema: 'zod', authorize: defaultAuthorize }),
    dashboard: screenTarget({ ...dashboardScreen, kayan: ['notes'], providers: [], controls: screenKinds, pages: { home: { path: '/', component: dashboardScreen.pages.dashboard!.component } } }),
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
