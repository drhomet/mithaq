// Written by `mithaq generate auth` from the Better Auth options generate.providers names. Do not edit.
// This kayan's access and what each screen draws of it are the project's:
// `session.access.ts` exporting `access` and `session.screens.ts` exporting
// `screens`, beside this file, are imported here on the next run. A kayan
// built under this one's name elsewhere is refused by every relationship to it.
import { defaultFields, defaultOperations } from 'mithaq'
import { defineKayan } from '../../../mithaq.ts'
import { user } from './user.ts'
import { access } from './session.access.ts'

export const session = defineKayan({
  name: 'session',
  targets: { service: { operations: defaultOperations } },
  access,
  fields: {
    ...defaultFields,
    id: { kind: 'text' },
    expiresAt: { kind: 'datetime', rules: { required: true } },
    token: { kind: 'text', rules: { required: true, unique: true } },
    createdAt: { kind: 'datetime', rules: { required: true } },
    updatedAt: { kind: 'datetime', rules: { required: true, nowOnUpdate: true, providedBy: { update: 'application' } } },
    ipAddress: { kind: 'text' },
    userAgent: { kind: 'text' },
    userId: { kind: 'relationship', relationTo: () => user, dbName: 'user_id', rules: { required: true, onDelete: 'cascade' } },
    impersonatedBy: { kind: 'text' },
    activeOrganizationId: { kind: 'text' },
  },
})
