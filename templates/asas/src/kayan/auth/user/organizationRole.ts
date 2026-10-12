// Written by `mithaq generate auth` from the Better Auth options generate.providers names. Do not edit.
// This kayan's access and what each screen draws of it are the project's:
// `organizationRole.access.ts` exporting `access` and `organizationRole.screens.ts` exporting
// `screens`, beside this file, are imported here on the next run. A kayan
// built under this one's name elsewhere is refused by every relationship to it.
import { defaultFields, defaultOperations } from 'mithaq'
import { defineKayan } from '../../../mithaq.ts'
import { organization } from './organization.ts'
import { access } from './organizationRole.access.ts'

export const organizationRole = defineKayan({
  name: 'organizationRole',
  dbName: 'organization_role',
  targets: { service: { operations: defaultOperations } },
  access,
  fields: {
    ...defaultFields,
    id: { kind: 'text' },
    organizationId: { kind: 'relationship', relationTo: () => organization, dbName: 'organization_id', rules: { required: true, onDelete: 'cascade' } },
    role: { kind: 'text', rules: { required: true } },
    permission: { kind: 'text', rules: { required: true } },
    createdAt: { kind: 'datetime', rules: { required: true } },
    updatedAt: { kind: 'datetime', rules: { nowOnUpdate: true, providedBy: { update: 'application' } } },
  },
})
