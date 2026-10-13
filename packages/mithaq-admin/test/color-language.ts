// A language whose own rukn brings a `color` kind no registry control or cell draws, built offline: its tables are made and nothing connects.
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
  defineRukn,
  drizzleAdapter,
  drizzleKinds,
  drizzleRules,
  fetchHttp,
  kind,
  screenKinds,
  screenTarget,
  serviceTarget,
  zodKinds,
  zodTarget,
} from 'mithaq'
import { dashboardScreen } from '../../../templates/asas/src/mithaq.ts'

const color = kind<string>((value): value is string => typeof value === 'string')({
  label: { en: 'Color', ar: 'لون' },
  message: { en: 'This is not a color.', ar: 'هذا ليس لونا.' },
  rules: ['required'],
  targets: { drizzle: drizzleKinds.text, zod: zodKinds.text, screen: { control: 'color', cell: 'color' } },
})

export const language = defineMithaq({
  locales: ['ar', 'en'] as const,
  arkan: [base, defineRukn({ name: 'colors', kinds: { color } })],
  targets: {
    drizzle: drizzleAdapter({ connectionString: 'postgresql://never-connected', kinds: drizzleKinds, rules: drizzleRules }),
    zod: zodTarget,
    service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'drizzle', schema: 'zod', authorize: defaultAuthorize }),
    dashboard: screenTarget({ ...dashboardScreen, kayan: ['swatches'], controls: screenKinds, pages: { home: { path: '/', component: dashboardScreen.pages.dashboard!.component } } }),
  },
})

export const swatches = language.defineKayan({
  name: 'swatches',
  fields: { id: defaultFields.id, color: { kind: 'color', label: { en: 'Color', ar: 'لون' } } },
  targets: { service: { operations: defaultOperations } },
})
