// Written by `mithaq generate auth` from the Better Auth options generate.providers names. Do not edit.
// This kayan's access and what each screen draws of it are the project's:
// `invitation.access.ts` exporting `access` and `invitation.screens.ts` exporting
// `screens`, beside this file, are imported here on the next run. A kayan
// built under this one's name elsewhere is refused by every relationship to it.
import { defaultFields, defaultOperations } from 'mithaq'
import { defineKayan } from '@asas/mithaq'
import { organization } from './organization.ts'
import { user } from './user.ts'
import { access } from './invitation.access.ts'

export const invitation = defineKayan({
  name: 'invitation',
  targets: { service: { operations: defaultOperations } },
  access,
  fields: {
    ...defaultFields,
    id: { kind: 'text' },
    organizationId: { kind: 'relationship', relationTo: () => organization, dbName: 'organization_id', rules: { required: true, index: true, onDelete: 'cascade' } },
    email: { kind: 'text', rules: { required: true, index: true } },
    role: { kind: 'text' },
    status: { kind: 'text', rules: { required: true } },
    expiresAt: { kind: 'datetime', rules: { required: true } },
    createdAt: { kind: 'datetime', rules: { required: true } },
    inviterId: { kind: 'relationship', relationTo: () => user, dbName: 'inviter_id', rules: { required: true, onDelete: 'cascade' } },
  },
})
