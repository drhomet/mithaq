// Written by `mithaq generate auth` from the Better Auth options generate.providers names. Do not edit.
// This kayan's access and what each screen draws of it are the project's:
// `verification.access.ts` exporting `access` and `verification.screens.ts` exporting
// `screens`, beside this file, are imported here on the next run. A kayan
// built under this one's name elsewhere is refused by every relationship to it.
import { defaultFields, defaultOperations } from 'mithaq'
import { defineKayan } from '@asas/mithaq'
import { access } from './verification.access.ts'

export const verification = defineKayan({
  name: 'verification',
  targets: { service: { operations: defaultOperations } },
  access,
  fields: {
    ...defaultFields,
    id: { kind: 'text' },
    identifier: { kind: 'text', rules: { required: true, index: true } },
    value: { kind: 'text', rules: { required: true } },
    expiresAt: { kind: 'datetime', rules: { required: true } },
    createdAt: { kind: 'datetime', rules: { required: true } },
    updatedAt: { kind: 'datetime', rules: { required: true, nowOnUpdate: true, providedBy: { update: 'application' } } },
  },
})
