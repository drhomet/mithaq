// How this project holds its people: how many organizations, and who may join. A module of its own,
// importing nothing, so a page reads it without loading the provider. `create-mithaq` writes it; a
// project changes it by hand, as the README's "Organization modes" says.

/**
 * How many organizations the project holds. In every mode a per-organization kayan places
 * `organization` and core scopes it, so a switch moves no row.
 *
 * - `'many'`: each sign-up founds its own organization.
 * - `'one'`: one organization, named, made on `/auth/first-run`.
 * - `'none'`: one organization, never shown, made on `/auth/first-run`.
 *
 * The tenant target reads it too: a start over more than one organization in `'one'` or `'none'` is
 * refused.
 */
export const organizations: 'none' | 'one' | 'many' = 'many'

/**
 * In `'one'` and `'none'`, who may make an account. `'many'` takes `'open'` alone: there each
 * sign-up founds its own organization.
 *
 * - `'invite'`: only someone holding an invitation, signing up with the invitation's id and address.
 *   Every other sign-up is refused with one answer, which tells nobody whether an address has an
 *   account.
 * - `'open'`: anyone, who joins the organization as `joinRole` once their address is verified (or
 *   at once when `verifyEmail` is false). A production start refuses it without a mailer.
 */
export const signUp: 'invite' | 'open' = 'open'

/**
 * The business role an open joiner is given, a slug of `roles/tenant-roles.ts`, or `null` for none:
 * the person joins, reads nothing, and an administrator gives them a role on the Members page,
 * which is how a project approves each joiner. Without the roles add-on it is `null`, and a joiner
 * holds the provider's `member`. `'many'` takes `null`: nobody joins there but by invitation.
 */
export const joinRole: string | null = null

/**
 * In `'one'` and `'none'` with an open sign-up, whether a new account proves its address by a mailed
 * link before it signs in and joins. `'many'` verifies no address yet, so it takes `false`.
 */
export const verifyEmail: boolean = false

/**
 * In `'one'` and `'none'` with an open sign-up and `verifyEmail`, the only address domains that may
 * sign up, lowercase ASCII (`xn--` for an international one): `example.com` is that domain alone, and
 * `*.example.com` every domain under it, never itself. Empty, any domain may.
 */
export const allowedDomains: readonly string[] = []
