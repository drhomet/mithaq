// Written by `mithaq generate auth` from the Better Auth options generate.providers names. Do not edit.
// This kayan's access and what each screen draws of it are the project's:
// `account.access.ts` exporting `access` and `account.screens.ts` exporting
// `screens`, beside this file, are imported here on the next run. A kayan
// built under this one's name elsewhere is refused by every relationship to it.
import { defaultFields, defaultOperations } from 'mithaq'
import { defineKayan } from '../../../mithaq.ts'
import { user } from './user.ts'
import { access } from './account.access.ts'

export const account = defineKayan({
  name: 'account',
  targets: { service: { operations: defaultOperations } },
  access,
  fields: {
    ...defaultFields,
    id: { kind: 'text' },
    accountId: { kind: 'text', rules: { required: true } },
    providerId: { kind: 'text', rules: { required: true } },
    userId: { kind: 'relationship', relationTo: () => user, dbName: 'user_id', rules: { required: true, onDelete: 'cascade' } },
    accessToken: { kind: 'text' },
    refreshToken: { kind: 'text' },
    idToken: { kind: 'text' },
    accessTokenExpiresAt: { kind: 'datetime' },
    refreshTokenExpiresAt: { kind: 'datetime' },
    scope: { kind: 'text' },
    password: { kind: 'text' },
    createdAt: { kind: 'datetime', rules: { required: true } },
    updatedAt: { kind: 'datetime', rules: { required: true, nowOnUpdate: true, providedBy: { update: 'application' } } },
  },
})
