import { localUsers } from './local-users/local-users.ts'
// Written by `mithaq generate auth`: one key per plugin the vocabulary names,
// and `core` for the four Better Auth ships without one. Spreading the keys is
// what keeps this list from naming eight files, and a project that drops the
// organization plugin drops one spread.
import { betterAuth } from './user/index.ts'

// The account other features point at, and the asas names its administrator by.
export { user } from './user/user.ts'

export const kayan = [...betterAuth.core, ...betterAuth.organization, localUsers] as const
