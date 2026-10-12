// This project's access for the generated `member` kayan, which `mithaq
// generate auth` imports into `./member.ts` because this file sits beside it. A
// platform role reads every organization's members in the platform app, by the
// keys it holds, and no one writes through it. There is no `'*'` row, so a
// tenant's actor takes no row here and reads nothing: a tenant lists its
// members through the provider's own `list-members`.
import { rows } from '../../../mithaq.ts'
import { platformReads } from '../../../tenant-access.ts'

export const access = rows(platformReads)
