import { authActor } from '../actor.ts'
import { heldPermissions } from '../../rbac/permissions.ts'
import { denied } from './errors.ts'
import { assertWhere } from './query.ts'
import type { ManagedAdmin } from './write.ts'
import type { Access, FieldAccess, ResolvedKayan } from '../../mithaq/types.ts'
import type { OperationEffect, Tools } from './steps.ts'
import type { Where } from '../../mithaq/where.ts'

export const defaultAccess = async <Actor>(admin: ManagedAdmin<Actor> | undefined, actor: Actor | null) => {
  if (!admin?.kayan || !admin.access || !actor || authActor(actor)?.collection !== admin.kayan) return false
  return admin.access({ user: actor })
}

export type Authorize = <Actor>(args: {
  admin?: ManagedAdmin<Actor>
  actor: Actor | null
  data: Record<string, unknown>
  effect: OperationEffect
  kayan: ResolvedKayan
  kind?: Tools['kind']
  // The named operation, not the effect: `courses.archive` is its own key.
  operation?: string
}) => Promise<Where | undefined>

// Asked of the one store that grades this actor. The row answers deny first, so this
// only narrows; a refusal is a 403, never a 5xx an offline client would retry.
const assertPermission = (kayan: ResolvedKayan, operation: string | undefined, actor: unknown) => {
  if (operation === undefined) return
  const keys = heldPermissions({ access: kayan.access, user: actor })
  if (keys === undefined || keys === true) return
  const key = `${kayan.name}.${operation}`
  if (keys.has(key)) return
  throw denied({
    message: `Forbidden: "${kayan.name}" operation "${operation}" needs permission "${key}".`,
    key: 'error.forbidden.permission',
    params: { kayan: kayan.name, operation },
  })
}

export const defaultAuthorize: Authorize = async <Actor>({
  admin,
  actor,
  data,
  effect,
  kayan,
  kind,
  operation: named,
}: {
  admin?: ManagedAdmin<Actor>
  actor: Actor | null
  data: Record<string, unknown>
  effect: OperationEffect
  kayan: ResolvedKayan
  kind?: Tools['kind']
  operation?: string
}) => {
  if (effect === 'read') {
    const access = kayan.access?.read
    const result = access
      ? await (access as Access<Actor, Record<string, unknown>, unknown>)({ id: data.id, slug: kayan.name, user: actor })
      : await defaultAccess(admin, actor)
    if (!result) throw denied({ message: `Forbidden: "${kayan.name}" read access denied.`, key: 'error.forbidden.read', params: { kayan: kayan.name } })
    assertPermission(kayan, named, actor)
    return result === true ? undefined : assertWhere(kayan, result)
  }
  const operation = effect
  const access = kayan.access?.[operation]
  const { id, ...values } = data
  const accessData = kind === 'insert' ? data : kind === 'update' ? values : undefined
  const result = access
    ? await (access as Access<Actor, Record<string, unknown>, unknown>)({ data: accessData, id, slug: kayan.name, user: actor })
    : await defaultAccess(admin, actor)
  if (operation === 'create') {
    if (result !== true) throw denied({ message: `Forbidden: "${kayan.name}" create access denied.`, key: 'error.forbidden.create', params: { kayan: kayan.name } })
    assertPermission(kayan, named, actor)
    return undefined
  }
  if (!result) throw denied({ message: `Forbidden: "${kayan.name}" ${operation} access denied.`, key: 'error.forbidden.operation', params: { kayan: kayan.name, operation } })
  assertPermission(kayan, named, actor)
  return result === true ? undefined : assertWhere(kayan, result)
}

export const projectReadableFields = async <Actor>({
  kayan,
  row,
  actor,
}: {
  kayan: ResolvedKayan
  row: Record<string, unknown>
  actor: Actor | null
}) => {
  const next = { ...row }
  for (const field of Object.values(kayan.fields)) {
    const access = field.access?.read
    if (!access || !(field.name in next)) continue
    const allowed = await (access as FieldAccess<Actor, Record<string, unknown>, unknown>)({ data: row, doc: row, id: row.id, siblingData: row, user: actor })
    if (!allowed) delete next[field.name]
  }
  return next
}



