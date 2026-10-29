import { actorPermissions } from '../asas/actor.ts'
import { rowsOf, type Held } from '../mithaq/rows.ts'

export const heldPermissions = ({ access, user }: { access: unknown; user: unknown }): Held =>
  actorPermissions(user) ?? rowsOf(access)?.permissions(user)
