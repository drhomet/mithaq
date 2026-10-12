// The tenant scope is core's and never a project's: it is ANDed onto whatever the project's
// access answers, so no row table, callback or authorizer can widen it.
import { authActor, markAuthActor, resolveAssigned, type AssignedResolver } from '../actor.ts'
import { isTenant, type Language, type Store } from '../../mithaq/language.ts'
import type { ResolvedKayan } from '../../mithaq/types.ts'
import { combineWhere, same, type Where } from '../../mithaq/where.ts'
import { AsasError, denied, invalid } from './errors.ts'
import { running } from './runtime.ts'
import type { OperationEffect, WriteTools } from './steps.ts'
import { assertReferences, type Authorize } from './write.ts'

/** How far a read reaches past the active organization: every verified membership, or every tenant. */
export type TenantReach = 'mine' | 'all'

/** A read's reach, opened once by the outermost read and kept by every managed call under it. */
export type TenantScope =
  | { reach: 'all' }
  // Each membership as an actor marked for that organization alone, with the roles it holds there.
  | { reach: 'mine'; members: ReadonlyMap<string, object> }

// The session must come from the one Better Auth kayan of the build, whose organizations the
// tenant kayan holds: another instance's organization ids name no tenant here.
const sessionOf = ({ actor, collection }: { actor: unknown; collection: string | undefined }) => {
  const trusted = authActor(actor)
  return collection !== undefined && trusted?.strategy === 'better-auth' && trusted.collection === collection ? trusted : null
}

/**
 * The organization the actor's verified Better Auth session has active, where the provider
 * lists the actor as its member; nothing for any other actor, which a tenant-owned kayan refuses.
 */
const activeTenant = ({ actor, collection }: { actor: unknown; collection: string | undefined }): string | undefined => {
  const trusted = sessionOf({ actor, collection })
  if (!trusted) return undefined
  const active = trusted.activeOrganizationId
  if (typeof active !== 'string' || !active || !Array.isArray(trusted.organizations)) return undefined
  return trusted.organizations.some((one) => one.id === active) ? active : undefined
}

// The organizations a `'mine'` answer admitted, kept by the answer itself so a read masks and
// judges each row by the membership it came through.
const admitted = new WeakMap<object, readonly string[]>()

/** The members of a `'mine'` scope whose organization `where` admitted, or nothing for any other answer. */
export const membersAdmitted = (scope: TenantScope | undefined, where: Where | undefined): object[] | undefined => {
  if (scope?.reach !== 'mine' || !where) return undefined
  const orgs = admitted.get(where)
  return orgs?.map((org) => scope.members.get(org)!)
}

/** Refused before any step runs: a write lands in the active organization alone. */
export const refuseTenantOption = ({ kayan, operation, options }: { kayan: ResolvedKayan; operation: string; options: unknown }) => {
  if (!options || typeof options !== 'object' || (options as { tenant?: unknown }).tenant === undefined) return
  throw invalid({
    message: `Kayan "${kayan.name}" operation "${operation}" writes in the active organization alone, so it takes no "tenant" option.`,
    key: 'error.invalid.tenant_option',
    params: { kayan: kayan.name, operation },
  })
}

/**
 * The organization a write to a tenant-owned kayan lands in, refused before any step runs where
 * there is none, and a caller's own value for the field refused as the derived shapes refuse it.
 */
export const writeTenant = ({ kayan, active, effect, data }: { kayan: ResolvedKayan; active: string | undefined; effect: OperationEffect; data: unknown }) => {
  if (!kayan.tenant) return undefined
  if (data && typeof data === 'object' && Object.hasOwn(data, kayan.tenant)) {
    throw invalid({
      message: `Unrecognized key: "${kayan.tenant}"`,
      key: 'error.invalid.value',
      params: { issues: [{ path: kayan.tenant, message: `Unrecognized key: "${kayan.tenant}"` }] },
    })
  }
  if (active === undefined) throw noScope(kayan, effect)
  return active
}

const noScope = (kayan: ResolvedKayan, effect: OperationEffect) =>
  denied({
    message: `Forbidden: "${kayan.name}" rows belong to an organization, and this actor's session has no active organization it is a verified member of.`,
    key: effect === 'read' ? 'error.forbidden.read' : effect === 'create' ? 'error.forbidden.create' : 'error.forbidden.operation',
    params: { kayan: kayan.name, operation: effect },
  })

/** The build's tenant scope: `open` reads a read's `tenant` option, `scoped` puts the scope under every answer. */
export const tenancy = ({ language, assigned, onError, collection }: {
  language: Language
  assigned: AssignedResolver | undefined
  onError: (error: unknown) => void
  /** The build's one Better Auth kayan, whose sessions alone name a tenant. */
  collection: string | undefined
}) => {
  const target = language.targets.tenant
  const active = (actor: unknown) => activeTenant({ actor, collection })
  const refused = (message: string) => denied({ message: `Forbidden: ${message}`, key: 'error.forbidden.read', params: {} })
  const open = async ({ actor, reach, kayan }: { actor: unknown; reach: unknown; kayan: ResolvedKayan }): Promise<TenantScope | undefined> => {
    if (reach === undefined) return undefined
    if (reach !== 'mine' && reach !== 'all') {
      throw invalid({ message: 'Managed read option "tenant" must be "mine" or "all".', key: 'error.invalid.tenant_option', params: { kayan: kayan.name } })
    }
    // A global is one row per tenant, so a read of one names its tenant.
    if (!isTenant(target) || kayan.single) {
      throw invalid({
        message: `Kayan "${kayan.name}" ${kayan.single ? 'is a global, whose read is its active organization\'s row' : 'is read in a build that lays down no tenant target'}, so it takes no "tenant" option.`,
        key: 'error.invalid.tenant_option',
        params: { kayan: kayan.name },
      })
    }
    if (reach === 'all') {
      const trusted = authActor(actor)
      if (!trusted || !target.platform || (await target.platform({ user: actor })) !== true) {
        throw refused('tenant "all" reads every organization, which only platform staff in the platform app may.')
      }
      return { reach }
    }
    // Without an access target the actor's roles are one set for every organization, and
    // carrying the active one's into another would widen it.
    const trusted = sessionOf({ actor, collection })
    if (!assigned || !trusted || !Array.isArray(trusted.organizations) || trusted.id === undefined || trusted.id === null) {
      throw refused('tenant "mine" reads the organizations a verified Better Auth session is a member of, each under the roles the access target holds there.')
    }
    const ids = [...new Set(trusted!.organizations!.map((one) => one.id).filter((id): id is string => typeof id === 'string' && id !== ''))]
    const members = new Map<string, object>()
    for (const org of ids) {
      // The trusted snapshot's facts, never the actor object's own keys. The provider's
      // governance role is the active organization's, so no other membership carries it.
      const base: Record<string, unknown> = {
        ...(actor as object),
        activeOrganizationId: org,
        collection: trusted!.collection,
        id: trusted!.id,
        memberRole: undefined,
        organizations: trusted!.organizations,
        role: trusted!.role,
        strategy: trusted!.strategy,
      }
      delete base.permissions
      delete base.roles
      const held = await resolveAssigned({ resolver: assigned, onError, tenant: org, member: trusted!.id, actor: base })
      members.set(org, markAuthActor({ ...base, permissions: held?.permissions ?? [], roles: held?.roles ?? [] }))
    }
    return { reach, members }
  }
  const scoped = (inner: Authorize): Authorize => async (args) => {
    const field = args.kayan.tenant
    if (!field) return inner(args)
    // A global is one organization's row, so a reach a read further out opened never reaches it.
    const scope = args.kayan.single ? undefined : running.getStore()?.tenant
    if (scope && args.effect !== 'read') refuseTenantOption({ kayan: args.kayan, operation: args.operation ?? args.effect, options: { tenant: scope.reach } })
    if (scope?.reach === 'all') return inner(args)
    if (scope?.reach === 'mine') {
      // One branch per answer that is the same value, so organizations whose roles answer alike share one.
      const groups: { orgs: string[]; where: Where | undefined }[] = []
      for (const [org, member] of scope.members) {
        let where: Where | undefined
        try {
          where = await inner({ ...args, actor: member as never })
        } catch (thrown) {
          if (thrown instanceof AsasError && thrown.status === 403) continue
          throw thrown
        }
        const group = groups.find((one) => same(one.where, where))
        if (group) group.orgs.push(org)
        else groups.push({ orgs: [org], where })
      }
      if (!groups.length) throw refused(`no organization this actor is a member of may read "${args.kayan.name}".`)
      const branches = groups.map(({ orgs, where }) => combineWhere({ [field]: { in: orgs } }, where)!)
      const answer = branches.length === 1 ? { and: [branches[0]!] } : { or: branches }
      admitted.set(answer, groups.flatMap(({ orgs }) => orgs))
      return answer
    }
    // Asked before the project's own answer, so no callback runs for an actor with no tenant.
    const org = active(args.actor)
    if (org === undefined) throw noScope(args.kayan, args.effect)
    const own = await inner(args)
    return args.effect === 'create' ? own : combineWhere({ [field]: { equals: org } }, own)
  }
  /**
   * The store a step is handed, sealed for every tenant-owned kayan it names: a row is made in
   * the active organization alone, and an update or delete reaches that organization's rows
   * alone and never names the field, whichever kayan the operation itself belongs to. A row
   * it writes names a tenant-owned row of the active organization alone, so another
   * organization's delete never reaches it.
   */
  const sealWrites = ({ writes, find, kayanOf }: { writes: WriteTools['store']; find: Store['find']; kayanOf: (name: string) => ResolvedKayan | undefined }): WriteTools['store'] => {
    const references = async ({ name, data, tx }: { name: string; data: Record<string, unknown>; tx: unknown }) => {
      const kayan = kayanOf(name)
      if (kayan) await assertReferences({ kayan, store: { find }, data, tenant: active(running.getStore()?.user), tx })
    }
    const sealed = (name: string, data?: Record<string, unknown>) => {
      const field = kayanOf(name)?.tenant
      if (!field) return undefined
      const org = active(running.getStore()?.user)
      if (org === undefined) throw new Error(`A step wrote kayan "${name}", whose rows belong to an organization, under no active organization.`)
      if (data && field in data) throw new Error(`A step wrote field "${field}" of kayan "${name}", and a row is made in its organization by the runner alone and never leaves it.`)
      return { [field]: { equals: org } } as Where
    }
    return Object.freeze({
      insert: async (args) => {
        const field = kayanOf(args.kayan)?.tenant
        if (field) {
          const org = active(running.getStore()?.user)
          if (org === undefined || args.data[field] !== org) {
            throw new Error(`A step made a row of kayan "${args.kayan}" in another organization than the active one, and a row is made in its own organization alone.`)
          }
        }
        await references({ name: args.kayan, data: args.data, tx: args.tx })
        return writes.insert(args)
      },
      update: async (args) => {
        const where = combineWhere(args.where, sealed(args.kayan, args.data))
        await references({ name: args.kayan, data: args.data, tx: args.tx })
        return writes.update({ ...args, where })
      },
      remove: (args) => writes.remove({ ...args, where: combineWhere(args.where, sealed(args.kayan)) }),
    })
  }
  return { open, scoped, active, sealWrites }
}
