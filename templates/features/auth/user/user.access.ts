// This project's access for the generated `user` kayan, which `mithaq generate
// auth` imports into `./user.ts` because this file sits beside it. The table is
// written here, beside the kayan it is for, and never in a file every kayan
// shares.
//
// A person is written through no managed operation: Better Auth writes it
// through its own adapter. The two sides of the platform line read it
// differently, and neither row reaches the other's side. In the tenant app a
// member reads its active organization's members by their id and their name
// alone, so a relationship to a person shows a name in the dashboard's cell and
// picker, and no email, role or ban reaches a tenant. Which members: all of them
// to a holder of `member.find`, otherwise itself and its roles' `peopleAudience`. In the platform app a
// platform role reads every person, each column where it holds that column's key.
//
// The id and the name are held by `namesInTenant` rather than by a field list
// on the `'*'` row, because every actor with a role takes the `'*'` row, the
// platform's included, and a column one row's list leaves out is hidden
// whatever the other rows say.
//
// The `'*'` row reads every person, and `membersOf` narrows it to the active
// organization's members: a person carries no tenant column, and a row filter
// reaches one relationship hop from the kayan's own fields, which `user` has
// none of toward `member`.
import { rows, serverTargets } from '@asas/mithaq'
import { membersOf, namesInTenant, platformReads } from '@asas/mithaq/roles/tenant-access.ts'

export const access = {
  ...rows({ '*': { read: true }, ...platformReads }, { holds: namesInTenant('user') }),
  read: membersOf(serverTargets.drizzle),
}
