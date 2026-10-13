// This project's access for the generated `session` kayan, which `mithaq generate
// auth` imports into `./session.ts` because this file sits beside it.
//
// Better Auth alone writes and reads this table, through its own adapter, so
// every managed operation on it is refused to every actor. Written out rather
// than left to the administrator's default, which a super admin passes in the
// platform app.
export { providerOnly as access } from '../../../roles/tenant-access.ts'
