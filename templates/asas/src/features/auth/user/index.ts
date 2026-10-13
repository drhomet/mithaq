// Written by `mithaq generate auth` from the Better Auth options generate.providers names. Do not edit.
// One key per plugin that brought tables of its own, and `core` for the tables
// Better Auth ships without one, so a project spreads these lists into
// `buildAsas` instead of naming every file. A plugin that leaves takes its key
// with it, and `mithaq generate auth --check` reports the drift.
import { account } from './account.ts'
import { invitation } from './invitation.ts'
import { member } from './member.ts'
import { organization } from './organization.ts'
import { organizationRole } from './organizationRole.ts'
import { session } from './session.ts'
import { user } from './user.ts'
import { verification } from './verification.ts'

export const betterAuth = {
  core: [user, session, account, verification],
  organization: [organization, organizationRole, member, invitation],
} as const
