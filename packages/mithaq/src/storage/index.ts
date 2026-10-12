import { kind } from '../base/kinds.ts'
import { defineRukn } from '../mithaq/rukn.ts'
import type { StandardSchemaV1 } from '../mithaq/standard-schema.ts'
import type { ResolvedField } from '../mithaq/types.ts'
import { kinds as drizzleKinds } from '../drizzle/kinds.ts'
import type { Tables } from '../drizzle/index.ts'
import { kinds as zodKinds } from '../zod/kinds.ts'
import { storageTarget, type StorageConfig } from './storage.ts'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const received = (value: unknown) => (value === null ? 'null' : typeof value)

const notAnId = ({ kind, value }: { kind: string | undefined; value: unknown }) => {
  if (kind === 'number') return typeof value === 'number' && Number.isFinite(value) ? undefined : `Invalid input: expected number, received ${received(value)}`
  if (typeof value !== 'string') return `Invalid input: expected string, received ${received(value)}`
  return kind === 'uuid' && !uuid.test(value) ? 'Invalid GUID' : undefined
}

/** A relationship to a kayan that holds files, drawn as a file picker. */
export const upload = kind<number | string>(
  (value): value is number | string => typeof value === 'number' || typeof value === 'string',
)({
  label: { en: 'Upload', ar: 'ملف مرفوع' },
  message: { en: 'Pick one of the listed files.', ar: 'اختر ملفا من القائمة.' },
  rules: ['providedBy', 'required', 'unique', 'index', 'defaultValue', 'onDelete'],
  pointsAtRow: true,
  // A file a row still names is never deleted from under it, whether or not the field is required.
  onDelete: 'restrict',
  targets: {
    // A set's join table restricts too, where a relationship's cascades.
    drizzle: (field: ResolvedField, tables: Tables) =>
      drizzleKinds.relationship(field.hasMany ? { ...field, rules: { ...field.rules, onDelete: 'restrict' } } : field, tables),
    zod: zodKinds.relationship,
    standardSchema: (field: ResolvedField): StandardSchemaV1<unknown, number | string> => ({
      '~standard': {
        version: 1,
        vendor: 'mithaq',
        validate: (value) => {
          const message = notAnId({ kind: field.target?.fields.id?.kind, value })
          return message ? { issues: [{ message }] } : { value: value as number | string }
        },
      },
    }),
    screen: { control: 'upload', cell: 'upload' },
  },
})

/**
 * The rukn a project lays down for files: `arkan: [base, storage(storageConfig)]`.
 * The config holds the signing secret, so the module that builds the language stays on the server.
 */
export const storage = (config: StorageConfig) =>
  defineRukn({ name: 'storage', kinds: { upload }, targets: { storage: storageTarget(config) } })
