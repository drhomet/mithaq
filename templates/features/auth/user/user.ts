// Written by `mithaq generate auth` from the Better Auth options generate.providers names. Do not edit.
// This kayan's access and what each screen draws of it are the project's:
// `user.access.ts` exporting `access` and `user.screens.ts` exporting
// `screens`, beside this file, are imported here on the next run. A kayan
// built under this one's name elsewhere is refused by every relationship to it.
import { betterAuth, defaultFields, defaultOperations } from 'mithaq'
import { defineKayan } from '@asas/mithaq'
import { providers } from '@asas/mithaq/auth'
import { access } from './user.access.ts'
import { screens } from './user.screens.ts'

export const user = defineKayan({
  name: 'user',
  auth: betterAuth({ server: providers.user.server }),
  targets: { dashboard: { useAsTitle: 'name' }, portal: { useAsTitle: 'name' }, ...screens, service: { operations: defaultOperations } },
  access,
  fields: {
    ...defaultFields,
    id: { kind: 'text' },
    name: { kind: 'text', rules: { required: true } },
    email: { kind: 'text', rules: { required: true, unique: true } },
    emailVerified: { kind: 'checkbox', rules: { required: true } },
    image: { kind: 'text' },
    createdAt: { kind: 'datetime', rules: { required: true } },
    updatedAt: { kind: 'datetime', rules: { required: true, nowOnUpdate: true, providedBy: { update: 'application' } } },
    role: { kind: 'text' },
    banned: { kind: 'checkbox' },
    banReason: { kind: 'text' },
    banExpires: { kind: 'datetime' },
  },
})
