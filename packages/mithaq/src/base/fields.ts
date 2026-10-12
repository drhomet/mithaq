import type { Field } from '../mithaq/types.ts'

/**
 * The `id` field alone, for a kayan that keeps no timestamps:
 * `fields: { ...defaultIdField, title }`.
 */
export const defaultIdField = {
  /** A uuid Postgres fills when a create leaves it out; a client may send its own, so rows can be made offline. */
  id: { kind: 'uuid', label: { en: 'ID', ar: 'المعرف' } },
} as const satisfies Record<string, Field>

/** The `updatedAt` and `createdAt` fields the runner writes, spread beside an id. */
export const defaultTimestampFields = {
  /** Written by the runner on every write that changes a row, and drawn disabled in the form. */
  updatedAt: {
    kind: 'datetime',
    label: { en: 'Updated at', ar: 'تاريخ التعديل' },
    rules: {
      required: true,
      defaultNow: true,
      nowOnUpdate: true,
      providedBy: { create: 'application', update: 'application' },
    },
  },
  /** Written by the runner on insert, and indexed because a read that names no sort orders by it. */
  createdAt: {
    kind: 'datetime',
    label: { en: 'Created at', ar: 'تاريخ الإنشاء' },
    rules: {
      required: true,
      defaultNow: true,
      index: true,
      providedBy: { create: 'application', update: 'application' },
    },
  },
} as const satisfies Record<string, Field>

/**
 * The `id`, `updatedAt` and `createdAt` fields a kayan spreads into its own
 * `fields`: `fields: { ...defaultFields, title }`. Spread order is column order, except that
 * a new table puts the two timestamps after every other column.
 */
export const defaultFields = { ...defaultIdField, ...defaultTimestampFields } as const

export const globalTypeLabel = { en: 'Global type', ar: 'النوع العام' } as const

/**
 * The field a global spreads into its own `fields`:
 * `fields: { ...defaultFields, ...defaultGlobalFields, siteTitle }`.
 */
export const defaultGlobalFields = {
  globalType: {
    kind: 'text',
    label: globalTypeLabel,
    rules: { required: true, unique: true },
    access: { update: () => false },
  },
} as const satisfies Record<string, Field>
