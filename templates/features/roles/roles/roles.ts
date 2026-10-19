import { actorRoles, conflict, defaultFields, denied, folderOf, grantedPermissions, writableRoleName, defaultOperations, type Ctx, type WriteTools } from 'mithaq'
import { user as users } from '@asas/auth'
import { assignedCount, managerRemains, memberRoles } from '../member-roles/member-roles.ts'
import { managesRoles } from '@asas/mithaq/roles/grants.ts'
import { defineKayan, rows, organization } from '@asas/mithaq'
import { appPage, backofficeList, backofficeRecord } from '@asas/mithaq/mithaq/pages.ts'
import { systemRoles } from '@asas/mithaq/roles/system-roles.ts'
import { backofficeReads } from '@asas/mithaq/roles/tenant-access.ts'

const rolesUi = folderOf(new URL('./ui/', import.meta.url))

/**
 * A tenant's own roles, each with a flat list of the catalog keys it grants. The roles this project ships are code, `systemRoles`, and never a row here;
 * a granter may not hand over a key it does not itself hold.
 */
/**
 * A tenant's role never holds `screen.backoffice`, which only a backoffice role holds: a row naming it would be a tenant claiming the backoffice.
 * It is refused before the granter check, so a root granter holding `'*'` is refused too.
 */
const BACKOFFICE_KEY = 'screen.backoffice'
const tenantKeysOnly = (ctx: Ctx): Ctx => {
  const written = (ctx.data as Record<string, unknown>).permissions
  if (!Array.isArray(written) || !written.includes(BACKOFFICE_KEY)) return ctx
  throw denied({
    message: `Forbidden: a "${ctx.kayan.name}" row is a tenant's role, and "${BACKOFFICE_KEY}" is held only by a backoffice role.`,
    key: 'error.forbidden.backoffice_key',
    params: { kayan: ctx.kayan.name, permissions: [BACKOFFICE_KEY] },
  })
}

const assignments = (tools: WriteTools, role: string) =>
  tools.of(memberRoles).find({ where: { role: { equals: role } }, limit: 100 })

/**
 * A role a member holds is neither deleted nor renamed, and no role takes a name an assignment of its tenant already names: either would leave a `memberRoles` row naming a role that is gone, armed later by a role with that name. Both refuse 409.
 * Holders are read as the actor, and an actor who may not read them is refused, because a write nobody could check does not go ahead. Assignments are counted through the store, so a role's author needs no `memberRoles` key.
 */
const unheld = async (ctx: Ctx, tools: WriteTools): Promise<Ctx> => {
  const before = ctx.dataBefore
  const name = before?.name
  const renamed = (ctx.data as { name?: unknown }).name
  const arriving = tools.kind === 'insert' || (tools.kind === 'update' && renamed !== name) ? renamed : undefined
  // The runner fills the organization on a create, and it is the active one.
  const tenantId = before?.organization ?? (ctx.data as { organization?: unknown }).organization
  if (typeof arriving === 'string') {
    const standing = await assignedCount({ ctx, tenantId, role: arriving })
    if (standing) {
      throw conflict({
        message: `Role "${arriving}" is named by ${standing} assignment(s) of this tenant that outlived their role, so no role takes that name until they are removed.`,
        key: 'error.conflict.role_assigned',
        params: { kayan: ctx.kayan.name, role: arriving, count: standing },
      })
    }
  }
  if (typeof name !== 'string' || (tools.kind === 'update' && (renamed === undefined || renamed === name))) return ctx
  const held = await assignments(tools, name)
  if (!held.totalDocs) return ctx
  const ids = held.docs.map((row) => String(row.user))
  const named = await tools.of(users).find({ where: { id: { in: ids } }, limit: 100 }).catch(() => ({ docs: [] as { id?: unknown; name?: unknown }[] }))
  const members = ids.map((id) => ({ id, name: String(named.docs.find((one) => one.id === id)?.name ?? id) }))
  throw conflict({
    message: `Role "${name}" is held by ${held.totalDocs} member(s), so it is not ${tools.kind === 'remove' ? 'deleted' : 'renamed'} until none holds it.`,
    key: 'error.conflict.role_held',
    params: { kayan: ctx.kayan.name, role: name, count: held.totalDocs, members },
  })
}

const keysOf = (value: unknown): readonly string[] => (Array.isArray(value) ? (value as string[]) : [])

/**
 * Nobody edits a role they hold so it stops letting them manage roles. The actor's roles are the ones the access target resolved for this tenant,
 * off the trusted snapshot; another member who may manage roles edits it.
 */
const keepsOwnRole = (ctx: Ctx): Ctx => {
  const before = ctx.dataBefore
  const keys = (ctx.data as { permissions?: unknown }).permissions
  if (!before || keys === undefined || !managesRoles(keysOf(before.permissions)) || managesRoles(keysOf(keys))) return ctx
  // The roles an assignment gives, not `assignedRoles`: the owner's added
  // `administrator` is a fixed role, which no update reaches.
  if (!actorRoles(ctx.actor)?.includes(String(before.name))) return ctx
  throw denied({
    message: `Forbidden: role "${String(before.name)}" is what lets this member manage roles, so they do not take its role-managing keys from it. Another member who may manage roles changes it.`,
    key: 'error.forbidden.own_role',
    params: { kayan: ctx.kayan.name, role: String(before.name) },
  })
}

/** A role that lets its holders manage roles loses that only while another member still may, whether its keys change or it is deleted. */
const keepsManagers = async (ctx: Ctx, tools: WriteTools): Promise<Ctx> => {
  const before = ctx.dataBefore
  if (!before || !managesRoles(keysOf(before.permissions))) return ctx
  const keys = tools.kind === 'remove' ? [] : keysOf((ctx.data as { permissions?: unknown }).permissions ?? before.permissions)
  if (managesRoles(keys)) return ctx
  await managerRemains({ ctx, tenantId: before.organization, change: { role: String(before.name), keys } })
  return ctx
}

const rolesAccess = rows({
  '*': { create: true, read: true, update: true, delete: true },
  /**
   * Every backoffice role reads the role rows of every tenant, and writes none. A
   * tenant that lost its administrator is repaired through `mithaq rbac assign`,
   * never from the backoffice app.
   */
  ...backofficeReads,
})

export const roles = defineKayan({
  name: 'roles',
  targets: {
    /** Every organization's rows on the backoffice, read-only. */
    backoffice: {
      useAsTitle: 'label',
      pages: {
        // A role by its label, never its slug, and its keys grouped as the
        // dashboard draws a fixed role's.
        ...backofficeList('/roles', { columns: ['label', 'organization'], filters: ['organization'], search: ['label'] }),
        ...backofficeRecord({
          path: '/roles/:id',
          main: [{ section: 'role', label: { en: 'Role', ar: 'الدور' }, fields: ['label', { field: 'permissions', cell: rolesUi('roles.tsx#Permissions') }] }],
        }),
      },
    },
    service: {
      operations: {
        ...defaultOperations,
        // The shipped lists with the guard in front of the store step: the runner
        // has parsed by then, so the column is already a list of strings, and the
        // write has not happened, so a refused grant leaves no row behind.
        create: { steps: ({ steps }) => [tenantKeysOnly, grantedPermissions, writableRoleName(systemRoles), unheld, steps.insert] },
        update: { steps: ({ steps }) => [tenantKeysOnly, grantedPermissions, writableRoleName(systemRoles), unheld, keepsOwnRole, keepsManagers, steps.update] },
        delete: { steps: ({ steps }) => [grantedPermissions, unheld, keepsManagers, steps.remove] },
      },
    },
    /**
     * The fixed roles list first, from their code, each with a lock and a read-only page; a custom role opens its form, where its permissions are grouped checkboxes, and its delete names the members who still hold it.
     */
    dashboard: {
      useAsTitle: 'label',
      description: {
        en: 'What each role in this organization may see and do.',
        ar: 'ما يمكن لكل دور في هذه المؤسسة أن يراه ويفعله.',
      },
      pages: {
        list: { path: '/roles', page: appPage([{ layout: 'table', main: [{ list: { columns: ['label', 'name', 'permissions'], limit: 100 }, component: rolesUi('roles.tsx#RolesTable') }] }]) },
        create: { path: '/roles/new', page: appPage([{ layout: 'record', main: [{ form: ['name', 'label', 'permissions'], component: rolesUi('role-form.tsx#RoleForm') }] }]) },
        edit: {
          path: '/roles/:id',
          page: appPage([
            {
              layout: 'record',
              main: [{ form: ['name', 'label', 'permissions'], component: rolesUi('role-form.tsx#RoleForm') }],
              danger: [{ button: 'delete', label: { en: 'Delete', ar: 'حذف' }, component: rolesUi('roles.tsx#DeleteRole') }],
            },
          ]),
        },
      },
    },
  },
  access: rolesAccess,
  fields: {
    ...defaultFields,
    organization,
    // Unique within the organization: two rows of one name would each grant their keys, so
    // deleting the one meant to revoke would leave the other granting.
    name: {
      kind: 'text',
      label: { en: 'Name', ar: 'الاسم' },
      // Trimmed, as the label below is, so neither is spaces alone.
      rules: { required: true, unique: true, trim: true, maxLength: 60, index: true },
    },
    /** What a person reads a role by, everywhere; the name is the slug an assignment names. */
    label: {
      kind: 'text',
      label: { en: 'Label', ar: 'التسمية' },
      rules: { required: true, localized: true, trim: true, maxLength: 60 },
    },
    permissions: {
      kind: 'textArray',
      label: { en: 'Permissions', ar: 'الصلاحيات' },
      rules: { required: true },
    },
  },
})
