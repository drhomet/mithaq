// Written by `mithaq generate auth` from the Better Auth options generate.providers names. Do not edit.
// This kayan's access and what each screen draws of it are the project's:
// `organization.access.ts` exporting `access` and `organization.screens.ts` exporting
// `screens`, beside this file, are imported here on the next run. A kayan
// built under this one's name elsewhere is refused by every relationship to it.
import { defaultFields, defaultOperations } from 'mithaq'
import { defineKayan } from '@asas/mithaq'
import { access } from './organization.access.ts'
import { screens } from './organization.screens.ts'

export const organization = defineKayan({
  name: 'organization',
  targets: { dashboard: { useAsTitle: 'name' }, ...screens, service: { operations: defaultOperations } },
  access,
  fields: {
    ...defaultFields,
    id: { kind: 'text' },
    name: { kind: 'text', rules: { required: true } },
    slug: { kind: 'text', rules: { required: true, unique: true } },
    logo: { kind: 'text' },
    createdAt: { kind: 'datetime', rules: { required: true } },
    metadata: { kind: 'text' },
    names: { kind: 'text' },
  },
})
