import { sql } from 'mithaq/drizzle'
import type { NodePgDatabase } from 'mithaq/drizzle/node-postgres'
import { assignableRole, conflict, defaultFields, defaultOperations, denied, type Ctx, type WriteTools } from 'mithaq'
import { defineKayan, backofficeUi, rows, organization } from '@asas/mithaq'
import { backofficeList, backofficeRecord, navGroups } from '@asas/mithaq/mithaq/pages.ts'
import { tenantRoles } from '@asas/mithaq/roles/system-roles.ts'
import { backofficeReads } from '@asas/mithaq/roles/tenant-access.ts'
import { managesRoles, OWNER, OWNER_ROLE } from '@asas/mithaq/roles/grants.ts'

const role = { field: 'role', cell: backofficeUi('role-cells.tsx#RoleName') } as const

/**
 * Nobody takes from themselves the role that lets them manage roles: their own
 * `administrator`, or any role holding a key that manages roles. Another member
 * holding the same keys removes it.
 *
 * A custom role's keys are read as the actor, through the role kayan's own
 * access, so a role the actor may not read is refused rather than taken off
 * unchecked. It guards a member's own row; two administrators removing each
 * other at once are `managerRemains`' to refuse.
 */
const keepsOwnManager = async (ctx: Ctx, tools: WriteTools): Promise<Ctx> => {
  const before = ctx.dataBefore
  const me = (ctx.actor as { id?: unknown } | undefined)?.id
  if (!before || me === undefined || before.user !== me) return ctx
  const after = { ...before, ...(ctx.data as Record<string, unknown>) }
  if (tools.kind === 'update' && after.user === before.user && after.role === before.role) return ctx
  const role = String(before.role)
  const roles = (tools.kayans as { roles: { find(input: object): Promise<{ docs: { permissions?: unknown }[] }> } }).roles
  const keys = Object.hasOwn(tenantRoles, role)
    ? tenantRoles[role as keyof typeof tenantRoles].permissions
    : (await roles.find({ where: { name: { equals: role } } })).docs.flatMap((row) => (Array.isArray(row.permissions) ? (row.permissions as string[]) : []))
  if (!managesRoles(keys)) return ctx
  throw denied({
    message: `Forbidden: role "${role}" is what lets this member manage roles, so it is not taken from themselves. Another member who may manage roles removes it.`,
    key: 'error.forbidden.own_role',
    params: { kayan: ctx.kayan.name, role },
  })
}

/** The write's transaction, which is drizzle's here. */
const txOf = (ctx: Ctx) => ctx.tx as NodePgDatabase

/**
 * How many assignments of one tenant name one role, counted inside the write's
 * own transaction rather than read as the actor: a number leaves this function
 * and no row does, so a role's author needs no `memberRoles` key to learn
 * whether a name is still carried.
 */
export const assignedCount = async ({ ctx, tenantId, role }: { ctx: Ctx; tenantId: unknown; role: string }): Promise<number> => {
  const [found] = (
    await txOf(ctx).execute<{ total: number }>(sql`select count(*)::int as total from member_roles where organization_id = ${String(tenantId)} and role = ${role}`)
  ).rows
  return found?.total ?? 0
}

/**
 * What a write changes about who manages roles: an assignment removed, or
 * moved to another member or role, or a custom role's keys, which are `[]`
 * when it is deleted.
 */
type Change = { assignment: Readonly<Record<string, unknown>>; becomes?: { user: unknown; role: unknown } } | { role: string; keys: readonly string[] }

/**
 * **Every tenant keeps a member who may manage roles**: one holding a role whose
 * keys `managesRoles` answers for, or the organization's owner, who always holds
 * `administrator`. A write that would leave none is refused 409
 * `error.conflict.last_manager`. Removing the owner's own `administrator` row
 * changes nothing the owner holds, so it is refused too, 403
 * `error.forbidden.owner_role`.
 *
 * The check runs under `pg_advisory_xact_lock` on the tenant, held to the end of
 * the write's transaction, and every guarded write takes the same lock first, so
 * two administrators removing each other at once are serialized and the second
 * reads the first's removal. `FOR UPDATE` on the manager assignments would not
 * do: which assignments manage roles also depends on the roles table, and a role
 * losing its keys touches no assignment row.
 *
 * Rows are read through the store rather than as the actor, because the answer
 * is about every member of the tenant and the actor may read few of them;
 * nothing read leaves this function but the refusal.
 */
export const managerRemains = async ({ ctx, tenantId, change }: { ctx: Ctx; tenantId: unknown; change: Change }): Promise<void> => {
  const tx = txOf(ctx)
  const tenant = String(tenantId)
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('mithaq.managers'), hashtext(${tenant}))`)
  const owners = (
    await tx.execute<{ user: string }>(
      sql`select user_id as "user" from member where organization_id = ${tenant} and ${OWNER} = any(string_to_array(role, ','))`,
    )
  ).rows.map((row) => row.user)
  if ('assignment' in change) {
    const { assignment, becomes } = change
    if (assignment.role === OWNER_ROLE && owners.includes(String(assignment.user)) && (becomes?.role !== assignment.role || becomes.user !== assignment.user)) {
      throw denied({
        message: `Forbidden: the organization's owner always holds "${OWNER_ROLE}", so the row saying so is not taken from them.`,
        key: 'error.forbidden.owner_role',
        params: { kayan: ctx.kayan.name, role: OWNER_ROLE },
      })
    }
  }
  if (owners.length) return
  const assigned = (await tx.execute<{ id: string; user: string; role: string }>(sql`select id, user_id as "user", role from member_roles where organization_id = ${tenant}`)).rows
  const custom = new Map<string, readonly string[]>(
    (await tx.execute<{ name: string; permissions: string[] }>(sql`select name, permissions from roles where organization_id = ${tenant}`)).rows.map((row) => [row.name, row.permissions] as const),
  )
  if ('keys' in change) custom.set(change.role, change.keys)
  const keysOf = (role: string) => (Object.hasOwn(tenantRoles, role) ? tenantRoles[role as keyof typeof tenantRoles].permissions : (custom.get(role) ?? []))
  const after = assigned.flatMap((row) => {
    if (!('assignment' in change) || row.id !== change.assignment.id) return [row]
    return change.becomes ? [{ ...row, role: String(change.becomes.role) }] : []
  })
  if (after.some((row) => managesRoles(keysOf(row.role)))) return
  throw conflict({
    message: `This write would leave the tenant with no member who may manage roles, so it is refused. Give another member such a role first.`,
    key: 'error.conflict.last_manager',
    params: { kayan: ctx.kayan.name },
  })
}

/** `managerRemains` for an assignment's update or delete; an update that neither moves the row nor changes its role changes nothing. */
const keepsAManager = async (ctx: Ctx, tools: WriteTools): Promise<Ctx> => {
  const before = ctx.dataBefore
  if (!before) return ctx
  const after = tools.kind === 'update' ? { ...before, ...(ctx.data as Record<string, unknown>) } : undefined
  if (after && after.user === before.user && after.role === before.role) return ctx
  await managerRemains({ ctx, tenantId: before.organization, change: { assignment: before, ...(after && { becomes: { user: after.user, role: after.role } }) } })
  return ctx
}

/**
 * Who holds which of this project's roles, per tenant: one row per member per
 * role. It exists so that Better Auth's own `member.role` never carries a
 * business role name beside its governance one: a role name holding a comma would
 * be accepted by `create-role` and could never be assigned again, because that
 * column is comma-delimited.
 *
 * The access target reads it straight from the store while the actor is being
 * made, filtered on this tenant and this member, so another tenant's row is
 * never in what comes back.
 */
export const memberRoles = defineKayan({
  name: 'memberRoles',
  dbName: 'member_roles',
  targets: {
    // Every organization's rows on the backoffice, read-only, and each row's
    // record. An assignment is looked for by its person, is titled by them, and
    // reads its role by the role's label, never its slug.
    backoffice: {
      nav: { icon: 'user-cog', group: navGroups.access },
      useAsTitle: 'user',
      pages: {
        ...backofficeList('/member-roles', { columns: ['user', role, 'organization'], filters: ['organization', 'user', 'role'], search: ['user.name', 'user.email'] }),
        ...backofficeRecord({ path: '/member-roles/:id', main: [{ section: 'assignment', label: { en: 'Assignment', ar: 'الإسناد' }, fields: ['user', role] }] }),
      },
    },
    // No dashboard page and so no nav entry: a member's roles are changed on the
    // Members page's sheet, which writes these rows through the operations below,
    // guards and all.
    service: {
      operations: {
        ...defaultOperations,
        // The gate in front of the store step: the runner has parsed by then, so
        // the column is a string, and the write has not happened, so a refused
        // assignment leaves no row. Without it a custom role holding
        // `memberRoles.create` assigns itself `administrator`. It is handed the
        // tenant roles alone, so a backoffice role such as `support` reads as an
        // unknown custom role and is refused 400. `'roles'` is the kayan it reads
        // the tenant's custom roles from.
        create: { steps: ({ steps }) => [assignableRole(tenantRoles, 'roles'), steps.insert] },
        update: { steps: ({ steps }) => [assignableRole(tenantRoles, 'roles'), keepsOwnManager, keepsAManager, steps.update] },
        // Removing an assignment is measured the way handing it out is. Without it
        // an actor delegated `memberRoles.delete` removes the tenant's only
        // administrator row. The guard reads the row the store holds, because a
        // delete names no column.
        delete: { steps: ({ steps }) => [assignableRole(tenantRoles, 'roles'), keepsOwnManager, keepsAManager, steps.remove] },
      },
    },
  },
  // Its own rows, since the inherited table would close the instructor's
  // delete here. Every backoffice role reads the assignments of every tenant in
  // the backoffice app and changes none; in the tenant app `assignedRoles` omits
  // the backoffice slugs.
  access: rows({
    '*': { create: true, read: true, update: true, delete: true },
    ...backofficeReads,
  }),
  /** A member holds a role once per tenant. A second assignment answers 409 `error.conflict.unique`. */
  indexes: [{ within: 'organization', unique: [['user', 'role']] }],
  fields: {
    ...defaultFields,
    organization,
    user: {
      kind: 'relationship',
      label: { ar: 'العضو', en: 'Member' },
      relationTo: 'user',
      // The assignment goes with the member: a deleted user holds no role, and
      // `restrict`, which a required relationship takes by default, would leave a
      // row nothing can reach standing in the way of the delete.
      rules: { required: true, index: true, onDelete: 'cascade' },
    },
    role: {
      kind: 'text',
      label: { ar: 'الدور', en: 'Role' },
      rules: { required: true, maxLength: 60, index: true },
    },
  },
})
