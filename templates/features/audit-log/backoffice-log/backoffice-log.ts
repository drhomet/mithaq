import { defaultFields, defaultOperations } from 'mithaq'
import { defineKayan, rows } from '@asas/mithaq'
import { backofficeList } from '@asas/mithaq/mithaq/pages.ts'
import { backofficeReads } from '@asas/mithaq/roles/tenant-access.ts'

/** Who did what to whom on the backoffice, as `action` names it. */
const actions = [
  { value: 'impersonate', label: { en: 'Started impersonating', ar: 'بدأ انتحال الصفة' } },
  { value: 'stopImpersonating', label: { en: 'Stopped impersonating', ar: 'أنهى انتحال الصفة' } },
  { value: 'setRole', label: { en: 'Set the backoffice role', ar: 'عيّن دور الإدارة الخلفية' } },
  { value: 'ban', label: { en: 'Banned', ar: 'حظر' } },
  { value: 'unban', label: { en: 'Lifted the ban', ar: 'رفع الحظر' } },
] as const

const text = (label: { en: string; ar: string }) => ({ kind: 'text', label }) as const

/**
 * The staff history: one row per impersonation started or stopped, backoffice
 * role set and ban set or lifted, written by the auth setup's backoffice hook
 * once the provider's route succeeded, and by nothing else. It belongs to no
 * organization, since staff act above every tenant, and it declares no
 * operation that writes, so no caller makes, edits or removes a row.
 *
 * Only a backoffice role reads it, in the backoffice app alone, and only one
 * holding its keys: the row table names no `'*'` row, so a tenant's
 * administrator, who holds every key of the project, takes no row of it and is
 * refused. The tenant app's screens list none of it.
 *
 * Each person is kept by id and by the address they had then, so the history
 * still says who once a person is renamed or removed.
 */
export const backofficeLog = defineKayan({
  name: 'backofficeLog',
  dbName: 'backoffice_log',
  messages: {
    singular: { en: 'Staff action', ar: 'إجراء طاقم' },
    plural: { en: 'Staff history', ar: 'سجل الطاقم' },
  },
  access: rows({ ...backofficeReads }),
  targets: {
    service: {
      operations: { find: defaultOperations.find, findByID: defaultOperations.findByID, count: defaultOperations.count },
    },
    backoffice: {
      pages: {
        ...backofficeList('/history', {
          columns: ['createdAt', 'action', 'actorEmail', 'targetEmail', 'previousRole', 'role', 'banReason'],
          filters: ['action', 'actorEmail', 'targetEmail', 'createdAt'],
          search: ['actorEmail', 'targetEmail'],
          sort: '-createdAt',
        }),
      },
    },
  },
  fields: {
    id: defaultFields.id,
    createdAt: defaultFields.createdAt,
    action: { kind: 'text', label: { en: 'Action', ar: 'الإجراء' }, options: actions, rules: { required: true } },
    actor: text({ en: 'Staff member', ar: 'عضو الطاقم' }),
    actorEmail: text({ en: 'Staff member\'s email', ar: 'بريد عضو الطاقم' }),
    target: text({ en: 'Person', ar: 'الشخص' }),
    targetEmail: text({ en: 'Person\'s email', ar: 'بريد الشخص' }),
    previousRole: text({ en: 'Role before', ar: 'الدور السابق' }),
    role: text({ en: 'Role after', ar: 'الدور الجديد' }),
    banReason: text({ en: 'Ban reason', ar: 'سبب الحظر' }),
  },
})
