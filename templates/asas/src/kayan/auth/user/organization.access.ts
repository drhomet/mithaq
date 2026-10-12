// This project's access for the generated `organization` kayan, which `mithaq
// generate auth` imports into `./organization.ts` because this file sits
// beside it. The table is written here, beside the kayan it is for, and never
// in a file every kayan shares.
//
// An organization is written through no managed operation: Better Auth writes
// it through its own adapter, and the platform renames one through its own route.
// In the tenant app a member reads its active organization, the one every tenant-owned
// row belongs to, and by its id and its name alone, so a tenant
// relationship shows a name on the dashboard. In the platform app a
// platform role reads every organization, each column where it holds that
// column's key. The id and the name are held by `namesInTenant` for the
// reason `./user.access.ts` gives.
import { rows } from '../../../mithaq.ts'
import { namesInTenant, platformReads, user } from '../../../tenant-access.ts'

export const access = rows(
  { '*': { read: { id: { equals: user.activeOrganizationId } } }, ...platformReads },
  { holds: namesInTenant('organization') },
)
