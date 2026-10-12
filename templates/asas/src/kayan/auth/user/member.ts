// Written by `mithaq generate auth` from the Better Auth options generate.providers names. Do not edit.
// This kayan's access and what each screen draws of it are the project's:
// `member.access.ts` exporting `access` and `member.screens.ts` exporting
// `screens`, beside this file, are imported here on the next run. A kayan
// built under this one's name elsewhere is refused by every relationship to it.
import { defaultFields, defaultOperations } from 'mithaq'
import { defineKayan } from '../../../mithaq.ts'
import { organization } from './organization.ts'
import { user } from './user.ts'
import { access } from './member.access.ts'
import { screens } from './member.screens.ts'

export const member = defineKayan({
  name: 'member',
  targets: { ...screens, service: { operations: defaultOperations } },
  access,
  fields: {
    ...defaultFields,
    id: { kind: 'text' },
    organizationId: { kind: 'relationship', relationTo: () => organization, dbName: 'organization_id', rules: { required: true, onDelete: 'cascade' } },
    userId: { kind: 'relationship', relationTo: () => user, dbName: 'user_id', rules: { required: true, onDelete: 'cascade' } },
    role: { kind: 'text', rules: { required: true } },
    createdAt: { kind: 'datetime', rules: { required: true } },
  },
})
